import { svgNode } from '../games/circuit-graphics.js';
import { applyMove, correctionColumns } from './engine.js';
import { simplifyCorrectionColumns } from './clifford.js';
import { correctionGlyph } from './correction-graphics.js';

const SIZE = 320, SLOT = 52, ROW = 48;
export const GRAPH_NODE_RADIUS = 21;

// Fixed labels and positions make rewrites easy to follow, without graph physics.
export function graphPositions(vertices) {
  return Array.from({ length: vertices }, (_, vertex) => {
    const angle = 2 * Math.PI * vertex / vertices - Math.PI / 2;
    return { x: SIZE / 2 + 112 * Math.cos(angle), y: SIZE / 2 + 112 * Math.sin(angle) };
  });
}

/** Pick the closest drawn segment, rather than an overlapping rectangular hit area. */
export function edgeAtPoint(graph, x, y, size) {
  const points = graphPositions(graph.vertices).map(point => ({ x: point.x * size / SIZE, y: point.y * size / SIZE }));
  let closest = null, distance = 22 ** 2;
  for (const edge of graph.edges) {
    const [a, b] = edge.map(vertex => points[vertex]), dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    const squared = (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
    if (squared < distance) { closest = edge; distance = squared; }
  }
  return closest;
}

function textNode(text, attrs) {
  const node = svgNode('text', attrs); node.textContent = text; return node;
}

function graphButton(className, label, locked) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = className; button.disabled = locked;
  button.setAttribute('aria-label', label); button.title = label;
  return button;
}

/** Native button overlays preserve keyboard, touch and tutorial behaviour. */
export function renderGraph(container, graph, { interactive = true, locked = false, highlight = null } = {}) {
  const positions = graphPositions(graph.vertices), fragment = document.createDocumentFragment();
  const svg = svgNode('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'graph-svg', 'aria-hidden': 'true' });
  container.classList.add('graph-canvas');
  container.dataset.interactive = String(interactive);
  for (const [u, v] of graph.edges) {
    const a = positions[u], b = positions[v];
    svg.appendChild(svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-line' }));
  }
  fragment.appendChild(svg);
  if (interactive) for (const [u, v] of graph.edges) {
    const a = positions[u], b = positions[v];
    const button = graphButton('graph-edge', `Pivot edge ${u + 1}–${v + 1}`, locked);
    button.title = ''; // Pointer selection follows the line, not overlapping button rectangles.
    button.dataset.edge = `${u}:${v}`;
    button.style.left = ((a.x + b.x) / 2 / SIZE * 100) + '%';
    button.style.top = ((a.y + b.y) / 2 / SIZE * 100) + '%';
    button.style.width = (Math.hypot(b.x - a.x, b.y - a.y) / SIZE * 100) + '%';
    button.style.transform = `translate(-50%, -50%) rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
    if (highlight?.edge?.includes(u) && highlight.edge.includes(v)) button.classList.add('is-highlighted');
    fragment.appendChild(button);
  }
  positions.forEach(({ x, y }, vertex) => {
    if (interactive) {
      const button = graphButton('graph-node', `Complement vertex ${vertex + 1}`, locked);
      button.dataset.vertex = String(vertex); button.textContent = String(vertex + 1);
      button.style.left = (x / SIZE * 100) + '%'; button.style.top = (y / SIZE * 100) + '%';
      if (highlight?.vertex === vertex) button.classList.add('is-highlighted');
      fragment.appendChild(button);
    } else {
      svg.appendChild(svgNode('circle', { cx: x, cy: y, r: GRAPH_NODE_RADIUS, class: 'graph-static-node' }));
      svg.appendChild(textNode(String(vertex + 1), { x, y: y + 1, class: 'graph-node-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }));
    }
  });
  container.replaceChildren(fragment);
}

/** Combine the corrections for the displayed replay prefix, independently on each wire. */
export function circuitTrace(initial, moves, activeStep = moves.length) {
  let graph = initial;
  const columns = [];
  for (let step = 0; step < Math.min(activeStep, moves.length); step++) {
    columns.push(...correctionColumns(graph, moves[step]));
    graph = applyMove(graph, moves[step]);
  }
  return { graph, columns: simplifyCorrectionColumns(initial.vertices, columns) };
}

export function renderCircuit(svg, initial, moves, { activeStep = moves.length, follow = false } = {}) {
  const { columns } = circuitTrace(initial, moves, activeStep);
  const width = 260, height = initial.vertices * ROW + 18;
  const left = (width - (Math.max(1, columns.length) - 1) * SLOT) / 2;
  svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const fragment = document.createDocumentFragment();
  const description = svgNode('desc');
  description.textContent = `Simplified Clifford corrections from the starting graph state to the current graph, after ${Math.min(activeStep, moves.length)} graph operations.`;
  fragment.appendChild(description);
  fragment.appendChild(textNode('|G₀⟩', { x: 7, y: 15, class: 'graph-state-label' }));
  fragment.appendChild(textNode('|G⟩', { x: width - 7, y: 15, class: 'graph-state-label', 'text-anchor': 'end' }));
  for (let vertex = 0; vertex < initial.vertices; vertex++) {
    const y = 44 + vertex * ROW;
    fragment.appendChild(svgNode('line', { x1: 30, x2: width - 12, y1: y, y2: y, class: 'graph-circuit-wire' }));
    fragment.appendChild(textNode(String(vertex + 1), { x: 18, y: y + 1, class: 'graph-wire-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }));
  }
  columns.forEach((entries, index) => {
    const group = svgNode('g', { class: 'graph-correction-column' });
    for (const { gate, wires } of entries) group.appendChild(correctionGlyph(gate, left + index * SLOT, 44 + wires[0] * ROW));
    fragment.appendChild(group);
  });
  svg.replaceChildren(fragment);
  if (follow && svg.parentElement) svg.parentElement.scrollLeft = 0;
}
