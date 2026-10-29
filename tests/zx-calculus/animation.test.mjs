import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, targetDiagram } from '../../src/lib/zx-calculus/engine.js';
import { animateDiagramMove, createRewriteScene, drawRewriteFrame, rewriteDuration, MOVE_DURATION, REPLAY_MOVE_DURATION } from '../../src/lib/zx-calculus/animation.js';
import { diagramLayout, drawDiagram, PHASE_RADIUS, ZX_COLORS } from '../../src/lib/zx-calculus/rendering.js';

function recorder() {
  const operations = [], saved = [];
  let transform = [1, 1, 0, 0];
  const transformed = (kind, args) => {
    const [sx, sy, x, y] = transform;
    if (kind === 'circle') return [args[0] * sx + x, args[1] * sy + y, args[2] * sx, ...args.slice(3)];
    if (kind === 'square') return [args[0] * sx + x, args[1] * sy + y, args[2] * sx, args[3] * sy];
    return args.map((value, index) => value * (index % 2 ? sy : sx) + (index % 2 ? y : x));
  };
  const ctx = { operations, globalAlpha: 1, save() { saved.push([this.globalAlpha, [...transform]]); }, restore() { [this.globalAlpha, transform] = saved.pop(); },
    translate(x, y) { transform[2] += x * transform[0]; transform[3] += y * transform[1]; }, scale(x, y) { transform[0] *= x; transform[1] *= y; }, clearRect() {}, beginPath() {},
    moveTo(...args) { operations.push({ kind: 'move', args, drawn: transformed('move', args), alpha: this.globalAlpha }); },
    quadraticCurveTo(...args) { operations.push({ kind: 'curve', args, drawn: transformed('curve', args), alpha: this.globalAlpha }); },
    arc(...args) { operations.push({ kind: 'circle', args, drawn: transformed('circle', args), alpha: this.globalAlpha, fill: this.fillStyle }); },
    fillRect(...args) { operations.push({ kind: 'square', args, drawn: transformed('square', args), alpha: this.globalAlpha }); }, closePath() {}, stroke() {}, fill() {} };
  return ctx;
}
const rect = { x: 0, y: 0, width: 800, height: 400 };
const visible = ctx => ctx.operations.filter(operation => operation.alpha > 0);
const circles = ctx => visible(ctx).filter(operation => operation.kind === 'circle' && operation.args[2] === 15).map(operation => operation.args.slice(0, 2));
const sectors = ctx => visible(ctx).filter(operation => operation.kind === 'circle' && Math.abs(operation.args[2] - PHASE_RADIUS) < 1e-8);
const sectorPhase = operation => operation ? (operation.args[4] - operation.args[3]) / (Math.PI / 2) : 0;
const darkSectors = ctx => visible(ctx).filter(operation => operation.kind === 'circle' && operation.fill === ZX_COLORS.ink);

function examples() {
  const identity = targetDiagram(), single = applyMove(identity, { rule: 'insert', edge: [0, 2], kind: 'z' });
  const split = applyMove(single, { rule: 'split', nodes: [4], phase: 3 });
  const hh = applyMove(identity, { rule: 'insert-hh', edge: [0, 2] });
  const opposite = applyMove(single, { rule: 'insert', edge: [1, 3], kind: 'x' });
  const linked = applyMove(opposite, { rule: 'add-hopf', nodes: [4, 5] });
  return [
    [split, { rule: 'fusion', nodes: [5, 4] }], [single, { rule: 'identity', nodes: [4] }],
    [hh, { rule: 'hh', nodes: [4, 5] }], [single, { rule: 'color', nodes: [4] }],
    [applyMove(linked, { rule: 'color', nodes: [4] }), { rule: 'color', nodes: [4] }],
    [linked, { rule: 'hopf', nodes: [4, 5] }], [identity, { rule: 'insert', edge: [0, 2], kind: 'x' }],
    [identity, { rule: 'insert-hh', edge: [0, 2] }], [single, { rule: 'split', nodes: [4], phase: 3 }],
    [opposite, { rule: 'add-hopf', nodes: [4, 5] }],
  ];
}

test('every rewrite and inverse has exact source and destination node positions', () => {
  for (const [before, move] of examples()) {
    const saved = structuredClone(before), after = applyMove(before, move), scene = createRewriteScene(before, move, after);
    assert.deepEqual(before, saved);
    for (const [progress, diagram, layout] of [[0, before, scene.beforeLayout], [1, after, scene.afterLayout]]) {
      const ctx = recorder(); drawRewriteFrame(ctx, scene, progress, rect);
      const expected = diagram.nodes.filter(node => node.kind === 'z' || node.kind === 'x').map(node => {
        const position = layout.positions.get(node.id);
        return [position.x + (scene.width - layout.width) / 2, position.y + (scene.height - layout.height) / 2];
      });
      assert.deepEqual(circles(ctx), expected, `${move.rule} at ${progress}`);
      assert.equal(visible(ctx).filter(operation => operation.kind === 'square').length, diagram.nodes.filter(node => node.kind === 'h').length);
      assert.deepEqual(sectors(ctx).map(sectorPhase), diagram.nodes.filter(node => node.phase).map(node => node.phase));
      assert.equal(ctx.globalAlpha, 1);
    }
  }
});

test('fixed replay rectangles match static endpoint drawings with the saved layouts', () => {
  const normalized = ctx => visible(ctx).map(operation => JSON.stringify([operation.kind, ...operation.drawn.map(value => typeof value === 'number' ? Number(value.toFixed(7)) : value)])).sort();
  for (const [before, move] of examples()) {
    const after = applyMove(before, move), scene = createRewriteScene(before, move, after);
    assert.equal(scene.beforeLayout.width, scene.afterLayout.width);
    assert.equal(scene.beforeLayout.height, scene.afterLayout.height);
    for (const [progress, diagram, layout] of [[0, before, scene.beforeLayout], [1, after, scene.afterLayout]]) {
      const animated = recorder(), fixed = recorder();
      drawRewriteFrame(animated, scene, progress, rect); drawDiagram(fixed, diagram, rect, { layout });
      assert.deepEqual(normalized(animated), normalized(fixed), `${move.rule} at ${progress}`);
    }
  }
});

test('every equation holds its matched source and complete result around the geometric rewrite', () => {
  for (const [before, move] of examples()) {
    const scene = createRewriteScene(before, move);
    const start = recorder(), held = recorder(), settled = recorder(), end = recorder();
    drawRewriteFrame(start, scene, 0, rect); drawRewriteFrame(held, scene, .125, rect);
    drawRewriteFrame(settled, scene, .875, rect); drawRewriteFrame(end, scene, 1, rect);
    assert.deepEqual(visible(held), visible(start), `${move.rule}: source hold`);
    assert.deepEqual(visible(settled), visible(end), `${move.rule}: result hold`);
  }
});

test('every rewrite preserves all surviving node and boundary coordinates without shrinking its canvas', () => {
  for (const [before, move] of examples()) {
    const layout = diagramLayout(before), positions = new Map(layout.positions);
    positions.set(0, { x: 28, y: 65 });
    if (positions.has(4)) positions.set(4, { x: positions.get(4).x + 17, y: positions.get(4).y + 9 });
    const saved = diagramLayout(before, { positions, width: 800, height: 400 });
    const after = applyMove(before, move), scene = createRewriteScene(before, move, after, { layout: saved });
    for (const node of after.nodes) if (saved.positions.has(node.id)) {
      assert.deepEqual(scene.afterLayout.positions.get(node.id), saved.positions.get(node.id), `${move.rule}, node ${node.id}`);
      const track = scene.nodes.find(track => track.id === node.id);
      if (track?.before) assert.deepEqual(track.from, track.to);
    }
    assert.ok(scene.afterLayout.width >= saved.width && scene.afterLayout.height >= saved.height);
    assert.equal(scene.afterLayout.positions.size, after.nodes.length);
  }
});

test('appearing and disappearing wires follow moving nodes, including the retracting Hopf front', () => {
  const [before, move] = examples()[6], insertion = createRewriteScene(before, move), p = .5;
  const t = (p - .15) / .45, movement = t * t * (3 - 2 * t);
  const moving = recorder(); drawRewriteFrame(moving, insertion, p, rect);
  const wire = insertion.wires.find(track => track.mode === 'in'), node = insertion.nodes.find(track => track.after?.id === 4);
  const nodePosition = { x: node.from.x + (node.to.x - node.from.x) * movement, y: node.from.y + (node.to.y - node.from.y) * movement };
  assert.deepEqual(wire.from.b, node.from); assert.deepEqual(wire.to.b, node.to);
  assert.ok(visible(moving).some(operation => operation.kind === 'curve' && Math.abs(operation.args[2] - nodePosition.x) < 1e-8 && Math.abs(operation.args[3] - nodePosition.y) < 1e-8));
  const diagram = {
    nodes: [...targetDiagram().nodes, ...Array.from({ length: 12 }, (_, index) => ({ id: index + 4, kind: index % 2 ? 'x' : 'z' }))],
    edges: [[0, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 2], [1, 5], [5, 7], [7, 9], [9, 11], [11, 13], [13, 15], [15, 3], [4, 15], [4, 15]],
  };
  const hopf = { rule: 'hopf', nodes: [4, 15] }, after = applyMove(diagram, hopf);
  const scene = createRewriteScene(diagram, hopf, after, { layout: diagramLayout(diagram), nextLayout: diagramLayout(after) }), removed = scene.wires.find(track => track.mode === 'hopf-out');
  assert.notDeepEqual([removed.from.a, removed.from.b], [removed.to.a, removed.to.b]);
  const ctx = recorder(); drawRewriteFrame(ctx, scene, .5, rect);
  const a = { x: removed.from.a.x + (removed.to.a.x - removed.from.a.x) * movement, y: removed.from.a.y + (removed.to.a.y - removed.from.a.y) * movement };
  const b = { x: removed.from.b.x + (removed.to.b.x - removed.from.b.x) * movement, y: removed.from.b.y + (removed.to.b.y - removed.from.b.y) * movement };
  const control = { x: removed.from.control.x + (removed.to.control.x - removed.from.control.x) * movement, y: removed.from.control.y + (removed.to.control.y - removed.from.control.y) * movement };
  const ht = (.5 - .15) / .69, trim = ht * ht * (3 - 2 * ht) / 2;
  const front = { x: (1 - trim) ** 2 * a.x + 2 * (1 - trim) * trim * control.x + trim ** 2 * b.x,
    y: (1 - trim) ** 2 * a.y + 2 * (1 - trim) * trim * control.y + trim ** 2 * b.y };
  assert.ok(visible(ctx).some(operation => operation.kind === 'move' && Math.abs(operation.args[0] - front.x) < 1e-8 && Math.abs(operation.args[1] - front.y) < 1e-8));
});

test('complementary phases fill the spider with colour without an empty intermediate disc', () => {
  const [before, move] = examples()[0], scene = createRewriteScene(before, move);
  const first = recorder(), approaching = recorder(), transferring = recorder(), filling = recorder(), final = recorder();
  drawRewriteFrame(first, scene, 0, rect); drawRewriteFrame(approaching, scene, .2, rect);
  drawRewriteFrame(transferring, scene, .4, rect); drawRewriteFrame(filling, scene, .56, rect);
  drawRewriteFrame(final, scene, 1, rect);
  assert.notDeepEqual(circles(first), circles(approaching), 'The bodies approach before either phase changes');
  assert.deepEqual(darkSectors(first).map(sectorPhase), [1, 3]);
  assert.deepEqual(darkSectors(approaching).map(sectorPhase).sort(), [1, 3]);
  assert.ok(darkSectors(transferring).some(sector => sectorPhase(sector) === 3 && sector.alpha < 1),
    'The incoming spider keeps its original phase as its body merges');
  const cutouts = darkSectors(filling);
  assert.equal(cutouts.length, 1);
  assert.ok(sectorPhase(cutouts[0]) > 0 && sectorPhase(cutouts[0]) < 1,
    'The original quarter cut-out shrinks as the solid colour fills it');
  assert.equal(sectors(final).length, 0);
});

test('all 32 coloured fusions keep cyclic sums and fill completed turns directly with colour', () => {
  for (const kind of ['z', 'x']) for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) {
    const before = { nodes: [...targetDiagram().nodes, { id: 4, kind, phase: first }, { id: 5, kind, phase: second }], edges: [[0, 4], [4, 5], [5, 2], [1, 3]] };
    const scene = createRewriteScene(before, { rule: 'fusion', nodes: [5, 4] });
    const label = `${kind} ${first}+${second}`, total = first + second, remainder = total % 4;
    if (total) assert.ok(rewriteDuration(scene) > MOVE_DURATION, label + ': sector transfer has time to read');
    else assert.equal(rewriteDuration(scene), MOVE_DURATION, label + ': ordinary fusion keeps its duration');
    let previousDark = first;
    for (const progress of [.2, .4, .56, .75]) {
      const ctx = recorder(); drawRewriteFrame(ctx, scene, progress, rect);
      if (total >= 4) {
        const target = scene.phaseFusion.target.from;
        const retained = darkSectors(ctx).find(sector => sector.args[0] === target.x && sector.args[1] === target.y);
        const dark = sectorPhase(retained);
        assert.ok(dark <= previousDark + 1e-8 && dark >= remainder - 1e-8,
          label + ': visible colour fills monotonically, preserving any final cut-out');
        assert.ok(darkSectors(ctx).every(sector => sectorPhase(sector) < 4), label + ': no empty intermediate disc');
        previousDark = dark;
      } else {
        assert.ok(Math.abs(darkSectors(ctx).reduce((sum, sector) => sum + sectorPhase(sector), 0) - total) < 1e-8,
          label + ': transferring a phase does not duplicate or discard it');
      }
    }
    if (total >= 4) {
      assert.ok(Math.abs(previousDark - remainder) < 1e-8, label + ': colour finishes filling before the animation settles');
    }
    const final = recorder(); drawRewriteFrame(final, scene, 1, rect);
    assert.deepEqual(darkSectors(final).map(sectorPhase), remainder ? [remainder] : [], label + ': exact final phase');
  }
});

test('colour change preserves the sector throughout the colour transition', () => {
  for (const kind of ['z', 'x']) for (let phase = 0; phase < 4; phase++) {
    const before = { nodes: [...targetDiagram().nodes, { id: 4, kind, phase }], edges: [[0, 4], [4, 2], [1, 3]] };
    const scene = createRewriteScene(before, { rule: 'color', nodes: [4] });
    for (const progress of [0, .25, .5, .75, 1]) {
      const ctx = recorder(); drawRewriteFrame(ctx, scene, progress, rect);
      assert.ok(sectors(ctx).every(sector => sectorPhase(sector) === phase));
      assert.equal(sectors(ctx).length > 0, phase > 0);
    }
  }
});

test('splitting sectors stays continuous at the beginning and matches both final cyclic phases', () => {
  for (const kind of ['z', 'x']) for (let original = 0; original < 4; original++) for (let split = 0; split < 4; split++) {
    const before = { nodes: [...targetDiagram().nodes, { id: 4, kind, phase: original }], edges: [[0, 4], [4, 2], [1, 3]] };
    const move = { rule: 'split', nodes: [4], phase: split }, after = applyMove(before, move), scene = createRewriteScene(before, move, after);
    const start = recorder(), end = recorder(), almostEnd = recorder(), staticEnd = recorder();
    drawRewriteFrame(start, scene, .001, rect);
    drawRewriteFrame(almostEnd, scene, .999, rect); drawRewriteFrame(end, scene, 1, rect);
    drawDiagram(staticEnd, after, rect, { layout: scene.afterLayout });
    const retained = sectors(start)[0];
    if (retained) assert.ok(Math.abs(sectorPhase(retained) - original) < .01, 'The original sector does not jump to an almost-full circle.');
    assert.deepEqual(sectors(end).map(sectorPhase), after.nodes.filter(node => node.phase).map(node => node.phase));
    assert.deepEqual(sectors(almostEnd).map(operation => operation.drawn), sectors(end).map(operation => operation.drawn));
    assert.deepEqual(sectors(end).map(operation => operation.drawn), sectors(staticEnd).map(operation => operation.drawn));
  }
});

test('Hopf contracts exactly two parallel wires and HH squares converge and shrink', () => {
  const [before, move] = examples().find(([, move]) => move.rule === 'hopf'), extra = applyMove(before, { rule: 'add-hopf', nodes: [4, 5] });
  const after = applyMove(extra, move), scene = createRewriteScene(extra, move, after);
  assert.equal(scene.wires.filter(wire => wire.mode === 'hopf-out').length, 2);
  const start = recorder(), moving = recorder(), final = recorder();
  for (const [ctx, progress] of [[start, 0], [moving, .5], [final, 1]]) drawRewriteFrame(ctx, scene, progress, rect);
  assert.notDeepEqual(visible(start).filter(operation => operation.kind === 'curve'), visible(moving).filter(operation => operation.kind === 'curve'));
  assert.equal(visible(final).filter(operation => operation.kind === 'curve').length, after.edges.length);
  const [hh, cancellation] = examples()[2], squares = recorder();
  drawRewriteFrame(squares, createRewriteScene(hh, cancellation), .7, rect);
  assert.ok(visible(squares).filter(operation => operation.kind === 'square').every(operation => operation.args[2] < 26 && operation.alpha < 1));
});

test('frame drawing needs no diagram, DOM, topology or layout work after planning', () => {
  const [before, move] = examples()[0], scene = createRewriteScene(before, move);
  const unavailable = new Proxy({}, { get() { throw new Error('Graph accessed during a frame'); } });
  const cached = { ...scene, before: unavailable, after: unavailable };
  const ctx = recorder();
  for (let step = 0; step <= 60; step++) drawRewriteFrame(ctx, cached, step / 60, rect);
  assert.ok(ctx.operations.length > 0);
  assert.ok(REPLAY_MOVE_DURATION < MOVE_DURATION);
});

function animationDom({ reduced = false, hidden = false, width = 400, parentWidth = 700 } = {}) {
  const callbacks = new Map(), viewListeners = new Map(), docListeners = new Map(), ctx = recorder();
  let nextFrame = 0, appended = 0, removed = 0;
  const view = { devicePixelRatio: 3, performance: { now: () => 0 }, matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame(fn) { callbacks.set(++nextFrame, fn); return nextFrame; }, cancelAnimationFrame(id) { callbacks.delete(id); },
    addEventListener(type, fn) { viewListeners.set(type, fn); }, removeEventListener(type) { viewListeners.delete(type); } };
  const svg = { style: { visibility: '' } }, stage = { style: { width: `${width}px`, aspectRatio: `${width} / 216` }, get offsetLeft() { return Math.max(0, (parentWidth - Number.parseFloat(this.style.width)) / 2); },
    querySelector: () => svg, appendChild() { appended++; } };
  const canvas = { dataset: {}, style: {}, getContext: () => ctx, setAttribute() {}, remove() { removed++; } };
  const doc = { hidden, defaultView: view, createElement: () => canvas, addEventListener(type, fn) { docListeners.set(type, fn); }, removeEventListener(type) { docListeners.delete(type); } };
  let scroll = 0;
  const container = { ownerDocument: doc, clientWidth: parentWidth,
    get scrollLeft() { return scroll; }, set scrollLeft(value) { scroll = Math.max(0, Math.min(value, Math.max(0, Number.parseFloat(stage.style.width) - parentWidth))); }, querySelector: () => stage };
  return { container, stage, svg, canvas, doc, ctx, callbacks, viewListeners, docListeners,
    get appended() { return appended; }, get removed() { return removed; },
    tick(time) { const pending = [...callbacks.values()]; callbacks.clear(); for (const callback of pending) callback(time); } };
}

test('the browser uses one DPR-capped canvas and cleans up on completion or cancellation', async () => {
  const [before, move] = examples()[0], scene = createRewriteScene(before, move), dom = animationDom();
  const animation = animateDiagramMove(dom.container, scene);
  assert.equal(dom.appended, 1); assert.equal(dom.svg.style.visibility, 'hidden');
  assert.equal(dom.canvas.width, 800);
  dom.tick(100); dom.tick(300); assert.equal(dom.appended, 1);
  dom.tick(rewriteDuration(scene)); assert.equal(await animation.finished, true);
  assert.equal(dom.removed, 1); assert.equal(dom.svg.style.visibility, '');
  assert.equal(dom.stage.style.width, '400px'); assert.equal(dom.callbacks.size, 0);
  assert.equal(dom.viewListeners.size, 0); assert.equal(dom.docListeners.size, 0);
  animation.cancel(); assert.equal(dom.removed, 1);
  const second = animateDiagramMove(dom.container, scene); second.cancel(); second.cancel();
  assert.equal(await second.finished, false); assert.equal(dom.removed, 2);
});

test('phased fusion takes extra time while replay speed and explicit timing remain predictable', async () => {
  const [before, move] = examples()[0], scene = createRewriteScene(before, move), dom = animationDom();
  const duration = rewriteDuration(scene), replayDuration = rewriteDuration(scene, REPLAY_MOVE_DURATION);
  assert.ok(duration > MOVE_DURATION && replayDuration > REPLAY_MOVE_DURATION);
  assert.equal(replayDuration / duration, REPLAY_MOVE_DURATION / MOVE_DURATION);
  for (const [diagram, action] of examples().slice(1)) assert.equal(rewriteDuration(createRewriteScene(diagram, action)), MOVE_DURATION,
    'Other equations keep their existing timing');
  const normal = animateDiagramMove(dom.container, scene);
  dom.tick(MOVE_DURATION);
  assert.equal(dom.removed, 0, 'The transfer has not been cut off at the old duration');
  dom.tick(duration); assert.equal(await normal.finished, true);
  const explicit = animateDiagramMove(dom.container, scene, { duration: 100 });
  dom.tick(99); assert.equal(dom.removed, 1);
  dom.tick(100); assert.equal(await explicit.finished, true);
  assert.equal(dom.removed, 2, 'An explicit duration is honoured exactly');
});

test('source and result holds do not redraw an unchanged canvas every frame', async () => {
  const [before, move] = examples()[0], dom = animationDom(), scene = createRewriteScene(before, move), duration = rewriteDuration(scene);
  const animation = animateDiagramMove(dom.container, scene);
  const source = dom.ctx.operations.length;
  dom.tick(40); dom.tick(100); assert.equal(dom.ctx.operations.length, source);
  dom.tick(300); assert.ok(dom.ctx.operations.length > source, 'The rewrite draws intermediate geometry');
  dom.tick(duration * .875);
  const result = dom.ctx.operations.length;
  dom.tick(duration * .95); assert.equal(dom.ctx.operations.length, result);
  dom.tick(duration); assert.equal(await animation.finished, true);
});

test('reduced motion, hidden pages and resize never leave an animation waiting', async () => {
  const [before, move] = examples()[0], scene = createRewriteScene(before, move);
  for (const option of [{ reduced: true }, { hidden: true }]) {
    const dom = animationDom(option), animation = animateDiagramMove(dom.container, scene);
    assert.equal(await animation.finished, true); assert.equal(dom.appended, 0); assert.equal(dom.callbacks.size, 0);
  }
  for (const event of ['visibilitychange', 'resize']) {
    const dom = animationDom(), animation = animateDiagramMove(dom.container, scene);
    if (event === 'visibilitychange') { dom.doc.hidden = true; dom.docListeners.get(event)(); }
    else dom.viewListeners.get(event)();
    assert.equal(await animation.finished, true); assert.equal(dom.removed, 1); assert.equal(dom.callbacks.size, 0);
  }
});

test('a canvas failure releases the input lock instead of leaving the animation pending', async () => {
  const [before, move] = examples()[0], dom = animationDom();
  const animation = animateDiagramMove(dom.container, createRewriteScene(before, move));
  dom.ctx.arc = () => { throw new Error('Canvas context lost'); };
  dom.tick(300);
  assert.equal(await animation.finished, false);
  assert.equal(dom.removed, 1); assert.equal(dom.callbacks.size, 0);
  assert.equal(dom.svg.style.visibility, '');
});

test('growing the native canvas keeps surviving symbols and viewport scroll fixed', async () => {
  const [before, move] = examples()[3], layout = diagramLayout(before), after = applyMove(before, move);
  const nextLayout = diagramLayout(after, { ...layout, width: 600 });
  const scene = createRewriteScene(before, move, after, { layout, nextLayout });
  const start = recorder(), end = recorder(), native = { x: 0, y: 0, width: scene.width, height: scene.height, scale: 1 };
  drawRewriteFrame(start, scene, 0, native); drawRewriteFrame(end, scene, 1, native);
  assert.deepEqual(circles(start), circles(end));
  for (const scroll of [0, 30]) {
    const dom = animationDom({ width: layout.width, parentWidth: 350 }); dom.container.scrollLeft = scroll;
    const animation = animateDiagramMove(dom.container, scene);
    assert.equal(dom.container.scrollLeft, scroll);
    dom.tick(MOVE_DURATION); assert.equal(await animation.finished, true);
    assert.equal(dom.stage.style.width, '600px');
    assert.equal(dom.container.scrollLeft, scroll);
  }
});
