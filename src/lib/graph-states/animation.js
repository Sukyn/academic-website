import { svgNode } from '../games/circuit-graphics.js';
import { applyMove, validateGraph } from './engine.js';
import { GRAPH_NODE_RADIUS, graphPositions, renderGraph } from './rendering.js';

// A pivot plays three complementations at this same pace, without compression.
export const COMPLEMENT_DURATION = 2400;

const edgeKey = ([u, v]) => `${Math.min(u, v)}:${Math.max(u, v)}`;
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);

// Begin visible motion at the circle edge rather than behind its opaque centre.
export function graphBoundary(from, to) {
  const fraction = GRAPH_NODE_RADIUS / Math.hypot(to.x - from.x, to.y - from.y);
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

/** Shared timing for the live SVG and downloaded replay. */
export function graphAnimationProgress(progress) {
  return { phase: progress < .22 ? 'pulse' : progress < .30 ? 'neighbours' : 'rewrite',
    travel: ease(clamp(progress / .22)), change: ease(clamp((progress - .30) / .64)) };
}

/** A pivot is three local complementations, each using its current neighbours. */
export function graphMoveStages(input, move) {
  let before = validateGraph(input);
  applyMove(before, move); // Validate the complete move before planning its first stage.
  const vertices = Object.hasOwn(move, 'edge') ? [move.edge[0], move.edge[1], move.edge[0]] : [move.vertex];
  return vertices.map(vertex => {
    const neighbours = before.edges.filter(edge => edge.includes(vertex))
      .map(([u, v]) => u === vertex ? v : u).sort((a, b) => a - b);
    const existing = new Set(before.edges.map(edgeKey)), pairs = [];
    for (let a = 0; a < neighbours.length; a++) for (let b = a + 1; b < neighbours.length; b++) {
      const edge = [neighbours[a], neighbours[b]];
      pairs.push({ edge, existed: existing.has(edgeKey(edge)) });
    }
    const after = applyMove(before, { vertex }), stage = { before, after, vertex, neighbours, pairs };
    before = after;
    return stage;
  });
}

function drawStage(container, stage, positions) {
  renderGraph(container, stage.before, { locked: true });
  const overlay = svgNode('g', { class: 'graph-animation', 'pointer-events': 'none', 'aria-hidden': 'true' });
  const svg = container.querySelector('.graph-svg');
  const lines = svg.querySelectorAll('.graph-line');
  const edgeLines = new Map(stage.before.edges.map((edge, index) => [edgeKey(edge), lines[index]]));
  const source = container.querySelector(`[data-vertex="${stage.vertex}"]`);
  const neighbours = stage.neighbours.map(vertex => container.querySelector(`[data-vertex="${vertex}"]`));
  const dots = stage.neighbours.map(vertex => {
    const origin = positions[stage.vertex], target = positions[vertex];
    const start = graphBoundary(origin, target), end = graphBoundary(target, origin);
    const node = svgNode('circle', { class: 'graph-animation-dot', cx: start.x, cy: start.y, r: 3.5, opacity: 1 });
    overlay.appendChild(node);
    return { node, start, end };
  });
  const pairs = stage.pairs.map(({ edge, existed }) => {
    const [a, b] = edge.map(vertex => positions[vertex]);
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const halves = [a, b].map(end => {
      const start = graphBoundary(end, middle);
      const node = svgNode('line', { class: `graph-animation-edge ${existed ? 'is-removing' : 'is-appearing'}`, x1: start.x, y1: start.y, x2: existed ? middle.x : start.x, y2: existed ? middle.y : start.y, opacity: 0 });
      overlay.appendChild(node);
      return { node, start, visible: false };
    });
    return { existed, halves, middle, base: edgeLines.get(edgeKey(edge)) };
  });
  svg.appendChild(overlay);
  source.classList.add('is-source');
  container.dataset.animationVertex = String(stage.vertex);
  let phase, affected = false, lastTravel = 0, lastChange = 0;
  return {
    update(progress) {
      const { phase: nextPhase, travel, change } = graphAnimationProgress(progress);
      if (nextPhase !== phase) {
        phase = nextPhase;
        container.dataset.animationPhase = phase;
        if (phase === 'rewrite') for (const { existed, halves, base } of pairs) {
          if (base) base.style.visibility = 'hidden';
          if (existed) for (const half of halves) {
            half.node.setAttribute('opacity', 1); half.visible = true;
          }
        }
      }
      const arrived = progress >= .22;
      if (arrived !== affected) {
        affected = arrived;
        for (const node of neighbours) node.classList.toggle('is-affected', arrived);
        for (const { node } of dots) node.setAttribute('opacity', 0);
      }
      if (!arrived) {
        if (travel === lastTravel) return;
        lastTravel = travel;
        for (const { node, start, end } of dots) {
          node.setAttribute('cx', start.x + (end.x - start.x) * travel);
          node.setAttribute('cy', start.y + (end.y - start.y) * travel);
        }
      }
      if (phase !== 'rewrite') return;
      if (change === lastChange) return;
      lastChange = change;
      for (const { existed, halves, middle } of pairs) {
        for (const half of halves) {
          const { node, start } = half;
          // Both fronts travel from their vertex to the shared midpoint.
          const x = change === 1 ? middle.x : start.x + (middle.x - start.x) * change;
          const y = change === 1 ? middle.y : start.y + (middle.y - start.y) * change;
          node.setAttribute(existed ? 'x1' : 'x2', x);
          node.setAttribute(existed ? 'y1' : 'y2', y);
          const visible = existed ? change < 1 : change > 0;
          if (visible !== half.visible) {
            node.setAttribute('opacity', visible ? 1 : 0); half.visible = visible;
          }
        }
      }
    },
    clear() {
      overlay.remove();
      source.classList.remove('is-source');
      for (const node of neighbours) node.classList.remove('is-affected');
      for (const { base } of pairs) if (base) base.style.visibility = '';
    },
  };
}

/** Animate geometry only; the caller owns the move, final render and input lock. */
export function animateGraphMove(container, graph, move) {
  const view = container.ownerDocument.defaultView;
  if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { finished: Promise.resolve(true), cancel() {} };
  }
  const stages = graphMoveStages(graph, move), positions = graphPositions(graph.vertices);
  let current = 0, drawing = drawStage(container, stages[0], positions), frame, settled = false, resolve;
  const start = view.performance.now();
  const finished = new Promise(done => { resolve = done; });
  const finish = completed => {
    if (settled) return;
    settled = true;
    view.cancelAnimationFrame(frame);
    drawing.clear();
    delete container.dataset.animationPhase;
    delete container.dataset.animationVertex;
    resolve(completed);
  };
  const tick = now => {
    if (settled) return;
    const elapsed = Math.max(0, now - start), next = Math.floor(elapsed / COMPLEMENT_DURATION);
    if (next >= stages.length) { finish(true); return; }
    if (next !== current) {
      drawing.clear();
      current = next;
      drawing = drawStage(container, stages[current], positions);
    }
    drawing.update((elapsed - current * COMPLEMENT_DURATION) / COMPLEMENT_DURATION);
    frame = view.requestAnimationFrame(tick);
  };
  drawing.update(0);
  frame = view.requestAnimationFrame(tick);
  return { finished, cancel: () => finish(false) };
}
