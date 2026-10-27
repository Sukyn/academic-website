import { applyMove, validateDiagram } from './engine.js';
import { diagramLayout, drawDiagramNode, drawPhaseSector, ZX_COLORS } from './rendering.js';

export const MOVE_DURATION = 800;
export const REPLAY_MOVE_DURATION = 560;
export const rewriteDuration = (scene, duration = MOVE_DURATION) => duration * (scene.phaseFusion ? 1.75 : 1);
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const point = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
const key = ([a, b]) => a < b ? `${a}:${b}` : `${b}:${a}`;
const at = (curve, t) => {
  const s = 1 - t;
  return { x: s * s * curve.a.x + 2 * s * t * curve.control.x + t * t * curve.b.x,
    y: s * s * curve.a.y + 2 * s * t * curve.control.y + t * t * curve.b.y };
};

const moveCurveEnds = (curve, a, b) => ({ a, b, control: {
  x: curve.control.x + (a.x + b.x - curve.a.x - curve.b.x) / 2,
  y: curve.control.y + (a.y + b.y - curve.a.y - curve.b.y) / 2,
} });
const mixCurve = (from, to, t) => ({ a: point(from.a, to.a, t), b: point(from.b, to.b, t), control: point(from.control, to.control, t) });

/** All topology, multiset matching and routing is computed once, before any frame. */
export function createRewriteScene(input, move, result, { layout, nextLayout } = {}) {
  const before = validateDiagram(input), after = result == null ? applyMove(before, move) : validateDiagram(result);
  const sourceLayout = layout || diagramLayout(before), destinationLayout = nextLayout || diagramLayout(after, sourceLayout);
  const width = Math.max(sourceLayout.width, destinationLayout.width), height = Math.max(sourceLayout.height, destinationLayout.height);
  // One top-left coordinate system keeps every surviving vertex still as the canvas grows.
  const beforeLayout = { ...sourceLayout, width, height }, afterLayout = { ...destinationLayout, width, height };
  const from = beforeLayout, to = afterLayout;
  const oldNodes = new Map(before.nodes.map(node => [node.id, node])), newNodes = new Map(after.nodes.map(node => [node.id, node]));
  const selected = move.nodes || [], added = after.nodes.filter(node => !oldNodes.has(node.id));
  const fusion = move.rule === 'fusion', splitting = move.rule === 'split';
  const survivor = fusion ? Math.min(...selected) : selected[0];
  const removedId = fusion ? Math.max(...selected) : null;
  const destinations = selected.map(id => to.positions.get(id) || from.positions.get(id));
  const centre = destinations.length ? destinations.reduce((p, q) => ({ x: p.x + q.x / destinations.length, y: p.y + q.y / destinations.length }), { x: 0, y: 0 }) : { x: width / 2, y: height / 2 };
  const anchor = fusion || splitting || move.rule === 'color' ? (to.positions.get(survivor) || from.positions.get(survivor)) : centre;
  const selectedEdge = move.edge ? key(move.edge) : null;
  const oldWire = selectedEdge ? before.edges.findIndex(edge => key(edge) === selectedEdge) : -1;
  const insertionPoint = oldWire >= 0 ? at(from.edges[oldWire], .5) : (from.positions.get(survivor) || anchor);
  const nodes = [];
  for (const [id, node] of oldNodes) if (node.kind !== 'boundary') {
    const next = newNodes.get(id);
    const phaseFrom = node.phase ?? 0;
    let phaseTo = next ? next.phase ?? 0 : phaseFrom;
    // Keep fusion totals unwrapped so each complete clockwise turn disappears.
    if (fusion && id === survivor) phaseTo = selected.reduce((sum, selectedId) => sum + (oldNodes.get(selectedId).phase ?? 0), 0);
    // A clockwise split avoids jumping from an empty sector to an almost-full one.
    else if (splitting && id === survivor) phaseTo = phaseFrom + ((phaseTo - phaseFrom + 4) % 4);
    nodes.push({ id, before: node, after: next, from: from.positions.get(id),
      to: next ? to.positions.get(id) : anchor, phaseFrom, phaseTo });
  }
  for (const node of added) if (node.kind !== 'boundary') nodes.push({ id: node.id, before: null, after: node,
    from: move.rule === 'color' ? from.positions.get(survivor) : insertionPoint, to: to.positions.get(node.id),
    phaseFrom: 0, phaseTo: node.phase ?? 0 });
  const nodeTracks = new Map(nodes.map(node => [node.id, node]));
  const source = id => nodeTracks.get(id)?.from || from.positions.get(id);
  const destination = id => nodeTracks.get(id)?.to || to.positions.get(id);

  const unmatched = new Map();
  after.edges.forEach((edge, index) => { const value = key(edge); if (!unmatched.has(value)) unmatched.set(value, []); unmatched.get(value).push(index); });
  const wires = [], used = new Set();
  const take = value => { const index = unmatched.get(value)?.shift(); if (index !== undefined) used.add(index); return index; };
  before.edges.forEach((edge, index) => {
    let target = take(key(edge));
    let reversed = false;
    if (target === undefined && fusion) {
      const mapped = edge.map(id => id === removedId ? survivor : id);
      target = take(key(mapped)); reversed = mapped[0] > mapped[1];
    }
    const end = target === undefined ? moveCurveEnds(from.edges[index], destination(edge[0]), destination(edge[1])) : to.edges[target];
    wires.push({ from: from.edges[index], to: reversed ? { a: end.b, b: end.a, control: end.control } : end,
      mode: target !== undefined ? 'keep' : move.rule === 'hopf' ? 'hopf-out' : 'out' });
  });
  after.edges.forEach((edge, index) => {
    if (!used.has(index)) wires.push({ from: moveCurveEnds(to.edges[index], source(edge[0]), source(edge[1])), to: to.edges[index], mode: move.rule === 'add-hopf' ? 'hopf-in' : 'in' });
  });

  const target = nodeTracks.get(survivor), sourceNode = nodeTracks.get(removedId);
  const phaseFusion = fusion && target.phaseTo > 0
    ? { target, source: sourceNode, fullTurn: target.phaseTo >= 4 } : null;
  return { beforeLayout, afterLayout, width, height, nodes, wires, phaseFusion };
}

function strokeCurve(ctx, curve, start = 0, end = 1) {
  if (end <= start) return;
  if (start === 0 && end === 1) {
    ctx.beginPath(); ctx.moveTo(curve.a.x, curve.a.y); ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.b.x, curve.b.y); ctx.stroke(); return;
  }
  const a = at(curve, start), b = at(curve, end), tangent = {
    x: (1 - start) * (curve.control.x - curve.a.x) + start * (curve.b.x - curve.control.x),
    y: (1 - start) * (curve.control.y - curve.a.y) + start * (curve.b.y - curve.control.y),
  };
  ctx.beginPath(); ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(a.x + (end - start) * tangent.x, a.y + (end - start) * tangent.y, b.x, b.y); ctx.stroke();
}

/** Geometry interpolation only: no layout, graph queries, DOM access or validation. */
export function drawRewriteFrame(ctx, scene, progress, rect) {
  const p = clamp(progress), fusion = p > .15 && p < .84 ? scene.phaseFusion : null;
  const movement = ease((p - .15) / (fusion ? .3 : .45)), appearance = ease((p - .16) / .29), disappearance = 1 - ease((p - .55) / .29);
  const phaseChange = ease((p - .35) / .49);
  const fusionSize = fusion ? 1 + .45 * ease((p - .4) / .1) * (1 - ease((p - .75) / .09)) : 1;
  const scale = rect.scale ?? Math.min(rect.width / scene.width, rect.height / scene.height);
  ctx.save(); ctx.translate(rect.x + (rect.width - scene.width * scale) / 2, rect.y + (rect.height - scene.height * scale) / 2); ctx.scale(scale, scale);
  ctx.strokeStyle = ZX_COLORS.wire; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const wire of scene.wires) {
    const curve = mixCurve(wire.from, wire.to, movement);
    if (wire.mode === 'keep') {
      ctx.globalAlpha = 1; strokeCurve(ctx, curve);
    } else if (wire.mode === 'hopf-out') {
      ctx.globalAlpha = 1; const t = ease((p - .15) / .69); strokeCurve(ctx, curve, t / 2, 1 - t / 2);
    } else if (wire.mode === 'hopf-in') {
      ctx.globalAlpha = 1; const t = ease((p - .15) / .69);
      if (t === 1) strokeCurve(ctx, curve);
      else { strokeCurve(ctx, curve, 0, t / 2); strokeCurve(ctx, curve, 1 - t / 2, 1); }
    } else {
      ctx.globalAlpha = wire.mode === 'out' ? disappearance : appearance;
      if (ctx.globalAlpha > 0) strokeCurve(ctx, curve);
    }
  }
  for (const node of scene.nodes) {
    const position = point(node.from, node.to, movement), shrinking = !node.after;
    const size = fusion && node === fusion.source ? 1 - ease((p - .35) / .15)
      : fusion && node === fusion.target ? fusionSize : shrinking ? disappearance : !node.before ? appearance : 1;
    let phase = mix(node.phaseFrom, node.phaseTo, phaseChange);
    if (fusion && (node === fusion.target || node === fusion.source)) {
      phase = fusion.fullTurn && node === fusion.source ? node.phaseFrom : 0;
    }
    if (size <= 0) continue;
    ctx.globalAlpha = clamp(size);
    if (node.before && node.after && node.before.kind !== node.after.kind) {
      ctx.globalAlpha = 1 - phaseChange; drawDiagramNode(ctx, node.before.kind, position.x, position.y, { scale: size, phase });
      ctx.globalAlpha = phaseChange;
    }
    drawDiagramNode(ctx, (node.after || node.before).kind, position.x, position.y, { scale: size, phase });
  }
  if (fusion) {
    const target = point(fusion.target.from, fusion.target.to, movement);
    ctx.globalAlpha = 1;
    if (fusion.fullTurn) {
      const remainder = fusion.target.after.phase ?? 0;
      // Add the incoming colour directly into the cut-out, without first emptying the spider.
      drawPhaseSector(ctx, target.x, target.y, mix(fusion.target.phaseFrom, remainder, ease((p - .35) / .4)),
        { scale: fusionSize });
    } else {
      drawPhaseSector(ctx, target.x, target.y, fusion.target.phaseFrom, { scale: fusionSize });
      const incoming = point(fusion.source.from, fusion.source.to, movement);
      drawPhaseSector(ctx, incoming.x, incoming.y, fusion.source.phaseFrom,
        { scale: fusionSize, start: fusion.target.phaseFrom * ease((p - .3) / .2) });
      if (fusion.source.phaseFrom) {
        ctx.globalAlpha = .8 * ease((p - .2) / .1) * (1 - ease((p - .5) / .125));
        ctx.strokeStyle = ZX_COLORS.wire; ctx.lineWidth = fusionSize; ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** One temporary canvas; the caller owns committing the final diagram and input lock. */
export function animateDiagramMove(container, scene, { duration = rewriteDuration(scene) } = {}) {
  const doc = container.ownerDocument, view = doc?.defaultView;
  if (!view || doc.hidden || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !(duration > 0)) return { finished: Promise.resolve(true), cancel() {} };
  const stage = container.querySelector('.zx-diagram'), svg = stage?.querySelector('.zx-svg');
  if (!stage || !svg) return { finished: Promise.resolve(true), cancel() {} };
  const canvas = doc.createElement('canvas'), ctx = canvas.getContext('2d');
  if (!ctx) return { finished: Promise.resolve(true), cancel() {} };
  const dpr = Math.min(2, view.devicePixelRatio || 1), oldWidth = stage.style.width, oldAspect = stage.style.aspectRatio, visibility = svg.style.visibility;
  const scroll = container.scrollLeft;
  canvas.width = Math.ceil(scene.width * dpr); canvas.height = Math.ceil(scene.height * dpr);
  canvas.dataset.zxAnimation = ''; canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  stage.style.width = `${scene.width}px`; stage.style.aspectRatio = `${scene.width} / ${scene.height}`;
  svg.style.visibility = 'hidden'; stage.appendChild(canvas);
  container.scrollLeft = scroll;
  ctx.scale(dpr, dpr);
  const rect = { x: 0, y: 0, width: scene.width, height: scene.height, scale: 1 };
  let frame, settled = false, resolve, lastDraw = -1;
  const finished = new Promise(done => { resolve = done; });
  const finish = completed => {
    if (settled) return;
    settled = true; view.cancelAnimationFrame(frame); view.removeEventListener('resize', resized); doc.removeEventListener('visibilitychange', hidden);
    if (!completed) {
      stage.style.width = oldWidth; stage.style.aspectRatio = oldAspect; container.scrollLeft = scroll;
    }
    canvas.remove(); svg.style.visibility = visibility;
    resolve(completed);
  };
  const resized = () => finish(true), hidden = () => { if (doc.hidden) finish(true); };
  view.addEventListener('resize', resized, { once: true }); doc.addEventListener('visibilitychange', hidden);
  const start = view.performance.now();
  const tick = now => {
    if (settled) return;
    try {
      const progress = clamp((now - start) / duration);
      const drawProgress = progress <= .15 ? 0 : progress >= .84 ? 1 : progress;
      if (drawProgress !== lastDraw) {
        ctx.clearRect(0, 0, scene.width, scene.height); drawRewriteFrame(ctx, scene, drawProgress, rect);
        lastDraw = drawProgress;
      }
      if (progress >= 1) finish(true); else frame = view.requestAnimationFrame(tick);
    } catch { finish(false); }
  };
  tick(start);
  return { finished, cancel: () => finish(false) };
}
