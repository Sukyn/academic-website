import { svgNode } from '../games/circuit-graphics.js';

export const ZX_COLORS = { z: '#9ad9b2', x: '#efa99e', h: '#f2d572', wire: '#e5ece7', ink: '#1b2822', selection: '#f2d572' };
const RADIUS = 15, MARGIN = 36;
const PLACEMENT_DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2]];
const WIRE_TARGET_SAMPLES = [.5, .45, .55, .4, .6, .35, .65, .3, .7, .25, .75, .2, .8, .15, .85, .1, .9]
  .map(t => [(1 - t) ** 2, 2 * (1 - t) * t, t * t]);
export const PHASE_RADIUS = 10;
const PHASE_SECTORS = ['no turn', 'quarter turn', 'half turn', 'three-quarter turn'].map((label, phase) => ({
  label, startAngle: -Math.PI / 2, endAngle: (phase - 1) * Math.PI / 2,
  path: phase ? `M0 0L0 -${PHASE_RADIUS}A${PHASE_RADIUS} ${PHASE_RADIUS} 0 ${phase === 3 ? 1 : 0} 1 ${[0, PHASE_RADIUS, 0, -PHASE_RADIUS][phase]} ${phase === 2 ? PHASE_RADIUS : 0}Z` : '',
}));
export const phaseSector = (phase = 0) => PHASE_SECTORS[(phase % 4 + 4) % 4];
const label = node => {
  if (node.kind === 'h') return 'Hadamard';
  return `${node.kind === 'z' ? 'Green' : 'Red'} spider, ${phaseSector(node.phase).label}`;
};

function distances(adjacency, sources) {
  const distance = new Map(sources.map(id => [id, 0])), queue = [...sources];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const next of adjacency.get(id) || []) if (!distance.has(next)) {
      distance.set(next, distance.get(id) + 1); queue.push(next);
    }
  }
  return distance;
}

function routeScore(a, b, control, obstacles) {
  if (!obstacles.length) return 0;
  const segments = [];
  let previous = a;
  for (let step = 1; step <= 16; step++) {
    const t = step / 16, s = 1 - t;
    const next = { x: s * s * a.x + 2 * s * t * control.x + t * t * b.x, y: s * s * a.y + 2 * s * t * control.y + t * t * b.y };
    const dx = next.x - previous.x, dy = next.y - previous.y;
    segments.push({ start: previous, dx, dy, lengthSquared: dx * dx + dy * dy || 1 }); previous = next;
  }
  let score = 0;
  for (const point of obstacles) {
    let nearest = Infinity;
    for (const { start, dx, dy, lengthSquared } of segments) {
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
      nearest = Math.min(nearest, Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy));
    }
    score += Math.max(0, 36 - nearest) ** 2;
  }
  return score;
}

function bendBounds(a, b, width, height) {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let minimum = -Infinity, maximum = Infinity;
  for (const [normal, centre, size] of [[-(b.y - a.y) / length, (a.x + b.x) / 2, width], [(b.x - a.x) / length, (a.y + b.y) / 2, height]]) {
    if (!normal) continue;
    const first = (4 - centre) / normal, last = (size - 4 - centre) / normal;
    minimum = Math.max(minimum, Math.min(first, last)); maximum = Math.min(maximum, Math.max(first, last));
  }
  return { minimum, maximum };
}

function automaticLayout(diagram) {
  const adjacency = new Map(diagram.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of diagram.edges) { adjacency.get(a)?.add(b); adjacency.get(b)?.add(a); }
  const left = distances(adjacency, [0, 1]), right = distances(adjacency, [2, 3]);
  const top = distances(adjacency, [0]), bottom = distances(adjacency, [1]);
  const depth = Math.max(2, ...[2, 3].map(id => left.get(id) || 1));
  const layers = new Map();
  for (const node of diagram.nodes) if (node.kind !== 'boundary') {
    const a = left.get(node.id), b = right.get(node.id);
    const column = a !== undefined && b !== undefined ? Math.max(1, Math.min(depth - 1, Math.round(a / (a + b) * depth))) : Math.ceil(depth / 2);
    if (!layers.has(column)) layers.set(column, []);
    layers.get(column).push(node);
  }
  const verticalOrder = id => {
    const a = top.get(id), b = bottom.get(id);
    return a === undefined ? 1 : b === undefined ? 0 : a / (a + b);
  };
  const byRow = (a, b) => verticalOrder(a.id) - verticalOrder(b.id) || a.id - b.id;
  const columns = [];
  for (const [, nodes] of [...layers].sort(([a], [b]) => a - b)) {
    // A broad spider neighbourhood should grow sideways, rather than making a tall stack.
    nodes.sort((a, b) => (left.get(a.id) || 0) - (left.get(b.id) || 0) || byRow(a, b));
    for (let start = 0; start < nodes.length; start += 4) columns.push(nodes.slice(start, start + 4).sort(byRow));
  }
  const width = Math.max(400, (columns.length + 1) * 86 + 2 * MARGIN);
  const height = Math.max(216, Math.max(1, ...columns.map(nodes => nodes.length)) * 80 + 2 * MARGIN);
  const positions = new Map([[0, { x: MARGIN, y: height / 3 }], [1, { x: MARGIN, y: 2 * height / 3 }], [2, { x: width - MARGIN, y: height / 3 }], [3, { x: width - MARGIN, y: 2 * height / 3 }]]);
  columns.forEach((nodes, column) => {
    nodes.forEach((node, index) => positions.set(node.id, {
      x: MARGIN + (column + 1) / (columns.length + 1) * (width - 2 * MARGIN),
      y: nodes.length === 1 ? (1 + verticalOrder(node.id)) / 3 * height : (index + 1) / (nodes.length + 1) * height,
    }));
  });
  return { width, height, positions };
}

function canvasExtent(positions, width = 0, height = 0) {
  width = Math.max(400, width); height = Math.max(216, height);
  for (const point of positions.values()) {
    width = Math.max(width, point.x + MARGIN); height = Math.max(height, point.y + MARGIN);
  }
  for (let id = 0; id < 4; id++) height = Math.max(height, (positions.get(id)?.y || 0) * (id % 2 ? 1.5 : 3));
  return { width, height };
}

function fixedLayout(diagram, previous, width, height) {
  const positions = new Map();
  for (const node of diagram.nodes) {
    const point = previous instanceof Map ? previous.get(node.id) : previous[node.id];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) positions.set(node.id, { x: point.x, y: point.y });
  }
  const missing = diagram.nodes.filter(node => !positions.has(node.id));
  if (!missing.length) return { positions, ...canvasExtent(positions, width, height) };
  const adjacency = new Map(diagram.nodes.map(node => [node.id, new Set()]));
  for (const [a, b] of diagram.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  const fallback = missing.some(node => node.kind === 'boundary') ? automaticLayout(diagram) : null;
  for (const node of missing.filter(node => node.kind === 'boundary')) positions.set(node.id, fallback.positions.get(node.id));
  let extent = canvasExtent(positions, width, height);
  for (const node of missing.filter(node => node.kind !== 'boundary')) {
    // Walk only through other new nodes, stopping at the nearest fixed neighbour on each branch.
    const seen = new Set([node.id]), queue = [[node.id, 0]], anchors = [];
    for (let index = 0; index < queue.length; index++) {
      const [id, distance] = queue[index];
      for (const next of adjacency.get(id)) if (!seen.has(next)) {
        seen.add(next);
        if (positions.has(next)) anchors.push({ point: positions.get(next), weight: 1 / (distance + 1) });
        else queue.push([next, distance + 1]);
      }
    }
    const total = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
    const origin = total ? anchors.reduce((point, anchor) => ({ x: point.x + anchor.point.x * anchor.weight / total, y: point.y + anchor.point.y * anchor.weight / total }), { x: 0, y: 0 }) : { x: extent.width / 2, y: extent.height / 2 };
    const occupied = [...positions.values()];
    let placed;
    // Prefer free room on the existing canvas; enlarge it only when necessary.
    for (let outside = 0; outside < 2 && !placed; outside++) for (let ring = 0; ring <= 2 * occupied.length + 1 && !placed; ring++) {
      for (const [dx, dy] of ring ? PLACEMENT_DIRECTIONS : [[0, 0]]) {
        const point = { x: origin.x + dx * ring * 72, y: origin.y + dy * ring * 72 };
        if (point.x < MARGIN || point.y < MARGIN || (!outside && (point.x > extent.width - MARGIN || point.y > extent.height - MARGIN))) continue;
        if (occupied.every(other => Math.hypot(point.x - other.x, point.y - other.y) >= 72)) { placed = point; break; }
      }
    }
    positions.set(node.id, placed);
    extent = canvasExtent(positions, extent.width, extent.height);
  }
  return { positions, ...extent };
}

/** Saved positions are fixed. Only a fresh layout, or new vertices, need placement. */
export function diagramLayout(diagram, { positions: previous, width: minimumWidth = 0, height: minimumHeight = 0 } = {}) {
  const initial = previous ? fixedLayout(diagram, previous, minimumWidth, minimumHeight) : automaticLayout(diagram);
  const positions = initial.positions, width = Math.max(minimumWidth, initial.width), height = Math.max(minimumHeight, initial.height);
  const internal = diagram.nodes.filter(node => node.kind !== 'boundary');
  const groups = new Map();
  diagram.edges.forEach(([a, b], index) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const offsets = new Map();
  for (const indices of groups.values()) {
    const [u, v] = diagram.edges[indices[0]], a = positions.get(Math.min(u, v)), b = positions.get(Math.max(u, v));
    const { minimum, maximum } = bendBounds(a, b, width, height);
    const spacing = Math.min(56, 2 * Math.min(-minimum, maximum) / Math.max(1, indices.length - 1));
    indices.forEach((index, order) => offsets.set(index, (order - (indices.length - 1) / 2) * spacing));
  }
  const edges = diagram.edges.map(([u, v], index) => {
    const a = positions.get(u), b = positions.get(v), length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const bend = offsets.get(index) * (u < v ? 1 : -1);
    const { minimum, maximum } = bendBounds(a, b, width, height);
    const obstacles = internal.filter(node => node.id !== u && node.id !== v).map(node => positions.get(node.id));
    let control, score = Infinity;
    // A wire crossing is harmless, but passing through another spider changes its meaning.
    for (const detour of [0, 56, -56, 112, -112]) {
      const bounded = Math.max(minimum, Math.min(maximum, bend + detour));
      const candidate = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * bounded, y: (a.y + b.y) / 2 + (b.x - a.x) / length * bounded };
      const candidateScore = routeScore(a, b, candidate, obstacles);
      if (candidateScore < score) { control = candidate; score = candidateScore; }
      if (score === 0) break;
    }
    return { index, a, b, control, midpoint: { x: (a.x + 2 * control.x + b.x) / 4, y: (a.y + 2 * control.y + b.y) / 4 }, path: `M${a.x} ${a.y}Q${control.x} ${control.y} ${b.x} ${b.y}` };
  });
  // Native wire controls need their own clear space, including beside parallel wires.
  const nodes = internal.map(node => positions.get(node.id)), assigned = [];
  const separate = (a, b) => Math.abs(a.x - b.x) >= 24 || Math.abs(a.y - b.y) >= 24;
  const clearOfNodes = point => nodes.every(other => Math.abs(point.x - other.x) >= 34 || Math.abs(point.y - other.y) >= 34);
  const targets = edges.map(edge => {
    const samples = WIRE_TARGET_SAMPLES.map(([a, control, b]) => ({ x: a * edge.a.x + control * edge.control.x + b * edge.b.x,
      y: a * edge.a.y + control * edge.control.y + b * edge.b.y }));
    return { edge, samples, points: samples.filter(clearOfNodes) };
  });
  // An 8px offset still keeps the wire inside its 24px button when crossed wires have no clear centres.
  const nearbyPoints = target => target.nearby ||= target.samples.flatMap(point =>
    [[8, 0], [-8, 0], [0, 8], [0, -8]].map(([x, y]) => ({ x: point.x + x, y: point.y + y }))).filter(clearOfNodes);
  const place = (target, points, alternatives = other => other.points) => {
    const { edge } = target;
    edge.hit = points.find(point => assigned.every(other => separate(point, other.edge.hit)));
    // One earlier flexible target may be moved; never recurse through the diagram.
    if (!edge.hit) for (const point of points) {
      const collisions = assigned.filter(other => !separate(point, other.edge.hit));
      if (collisions.length !== 1) continue;
      const other = collisions[0], alternative = alternatives(other).find(candidate => separate(candidate, point) && assigned.every(previous => previous === other || separate(candidate, previous.edge.hit)));
      if (alternative) { other.edge.hit = alternative; edge.hit = point; break; }
    }
  };
  // Reserve short or crowded wire segments before more flexible ones.
  for (const target of targets.sort((a, b) => a.points.length - b.points.length || a.edge.index - b.edge.index)) {
    const { edge, points } = target;
    place(target, points);
    if (!edge.hit) place(target, [...points, ...nearbyPoints(target)], other => [...other.points, ...nearbyPoints(other)]);
    edge.hit ||= edge.midpoint;
    assigned.push(target);
  }
  return { width, height, positions, edges };
}

function appendNode(svg, node, x, y, { selected = false } = {}) {
  const group = svgNode('g', { ...(node.id !== undefined ? { 'data-zx-node': node.id } : {}), transform: `translate(${x} ${y})` });
  if (selected) group.appendChild(svgNode('circle', { r: 23, fill: 'none', stroke: ZX_COLORS.selection, 'stroke-width': 2.5 }));
  if (node.kind === 'h') group.appendChild(svgNode('rect', { x: -13, y: -13, width: 26, height: 26, rx: 1.5, fill: ZX_COLORS.h }));
  else {
    group.appendChild(svgNode('circle', { r: RADIUS, fill: ZX_COLORS[node.kind], stroke: ZX_COLORS.ink, 'stroke-width': 1.5 }));
    const sector = phaseSector(node.phase);
    if (sector.path) group.appendChild(svgNode('path', { d: sector.path, fill: ZX_COLORS.ink, class: 'zx-phase-sector' }));
  }
  svg.appendChild(group); return group;
}

const drawings = new WeakMap();
function positionButton(button, point, layout) {
  button.style.left = `${point.x / layout.width * 100}%`; button.style.top = `${point.y / layout.height * 100}%`;
}
function updateGeometry(drawing, layout) {
  const { stage, svg, interactive, paths, hitPaths, groups, nodeButtons, edgeButtons } = drawing;
  stage.style.width = interactive ? `${layout.width}px` : '100%'; stage.style.aspectRatio = `${layout.width} / ${layout.height}`;
  svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
  layout.edges.forEach(edge => {
    paths[edge.index].setAttribute('d', edge.path);
    hitPaths[edge.index]?.setAttribute('d', edge.path);
    if (edgeButtons.has(edge.index)) positionButton(edgeButtons.get(edge.index), edge.hit, layout);
  });
  for (const [id, group] of groups) {
    const point = layout.positions.get(id); group.setAttribute('transform', `translate(${point.x} ${point.y})`);
    if (nodeButtons.has(id)) positionButton(nodeButtons.get(id), point, layout);
  }
  drawing.layout = layout;
}

/** Move existing SVG symbols and hit targets without replacing DOM or losing pointer capture. */
export function updateDiagramPositions(container, diagram, view) {
  const drawing = drawings.get(container);
  if (!drawing) throw new TypeError('Render the diagram before moving its nodes.');
  const layout = diagramLayout(diagram, { width: drawing.layout.width, height: drawing.layout.height, ...view });
  updateGeometry(drawing, layout); return layout;
}

/** DOM-safe native hit targets, shared by mouse, touch and keyboard selection. */
export function renderDiagram(container, diagram, { selected = new Set(), selectedEdge = null, interactive = true, locked = false, layout = diagramLayout(diagram) } = {}) {
  const stage = document.createElement('div');
  stage.className = 'zx-diagram';
  container.classList.add('zx-canvas');
  const svg = svgNode('svg', { class: 'zx-svg', 'aria-hidden': 'true' });
  const drawing = { stage, svg, interactive, paths: [], hitPaths: [], groups: new Map(), nodeButtons: new Map(), edgeButtons: new Map(), layout };
  for (const edge of layout.edges) {
    const path = svgNode('path', { class: 'zx-wire', 'data-zx-edge': edge.index, fill: 'none', stroke: edge.index === selectedEdge ? ZX_COLORS.selection : ZX_COLORS.wire, 'stroke-width': 2.5, 'stroke-linecap': 'round' });
    svg.appendChild(path); drawing.paths.push(path);
  }
  if (interactive) for (const edge of layout.edges) {
    const path = svgNode('path', { class: 'zx-wire-hit', 'data-edge-hit': edge.index, fill: 'none', stroke: 'transparent', 'stroke-width': 24 });
    svg.appendChild(path); drawing.hitPaths.push(path);
  }
  for (const node of diagram.nodes) if (node.kind !== 'boundary') {
    drawing.groups.set(node.id, appendNode(svg, node, 0, 0, { selected: selected.has(node.id) }));
  }
  stage.appendChild(svg);
  const button = (className, accessibleName, data, value) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = className; element.disabled = locked;
    element.setAttribute('aria-label', accessibleName); element.dataset[data] = String(value);
    stage.appendChild(element); return element;
  };
  if (interactive) {
    for (const edge of layout.edges) {
      const element = button('zx-edge', 'Select wire', 'edge', edge.index); drawing.edgeButtons.set(edge.index, element);
      element.setAttribute('aria-pressed', String(edge.index === selectedEdge));
    }
    for (const node of diagram.nodes) if (node.kind !== 'boundary') {
      const element = button('zx-node', label(node), 'node', node.id); drawing.nodeButtons.set(node.id, element);
      element.setAttribute('aria-pressed', String(selected.has(node.id)));
    }
  }
  updateGeometry(drawing, layout); drawings.set(container, drawing);
  const focused = container.contains?.(document.activeElement) ? { ...document.activeElement.dataset } : null;
  container.replaceChildren(stage);
  if (focused) for (const element of stage.querySelectorAll?.('button') || []) if (!element.disabled && ((focused.node !== undefined && element.dataset.node === focused.node) || (focused.edge !== undefined && element.dataset.edge === focused.edge))) element.focus({ preventScroll: true });
  return layout;
}

export function nodeGlyph(kind, phase = 0) {
  const svg = svgNode('svg', { viewBox: '0 0 44 44', width: 36, height: 36, class: 'zx-glyph', 'aria-hidden': 'true' });
  appendNode(svg, { kind, phase }, 22, 22); return svg;
}

/** Colour change adds Hadamards; the other equations also have reverse choices. */
export function ruleGlyph(rule, { direction = 0 } = {}) {
  if (rule === 'color') direction = 1;
  const svg = svgNode('svg', { viewBox: '0 0 160 56', width: 144, height: 50.4, class: 'zx-rule-glyph', 'aria-hidden': 'true' });
  const wire = d => svg.appendChild(svgNode('path', { d, fill: 'none', stroke: ZX_COLORS.wire, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const dot = (kind, x, y, radius = 8) => svg.appendChild(kind === 'h'
    ? svgNode('rect', { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2, rx: 1, fill: ZX_COLORS.h })
    : svgNode('circle', { cx: x, cy: y, r: radius, fill: ZX_COLORS[kind], stroke: ZX_COLORS.ink, 'stroke-width': 1 }));
  wire(`M72 28H90${direction <= 0 ? 'M77 23L72 28L77 33' : ''}${direction >= 0 ? 'M85 23L90 28L85 33' : ''}`);
  if (rule === 'fusion') {
    wire('M3 28H61M102 28H157'); dot('z', 18, 28); dot('z', 46, 28); dot('z', 129, 28);
  } else if (rule === 'identity') {
    wire('M3 28H61M102 28H157'); dot('z', 32, 28);
  } else if (rule === 'hh') {
    wire('M3 28H61M102 28H157'); dot('h', 19, 28); dot('h', 45, 28);
  } else if (rule === 'color') {
    wire('M5 7L33 28 5 49M33 28H61M103 7L131 28 103 49M131 28H157');
    dot('z', 33, 28); dot('x', 131, 28);
    dot('h', 114, 15, 5); dot('h', 114, 41, 5); dot('h', 148, 28, 5);
  } else if (rule === 'hopf') {
    wire('M3 10L17 28 3 46M47 28L61 10M47 28L61 46M17 28Q32 6 47 28M17 28Q32 50 47 28M102 10L116 28 102 46M143 28L157 10M143 28L157 46');
    dot('z', 17, 28); dot('x', 47, 28); dot('z', 116, 28); dot('x', 143, 28);
  }
  return svg;
}

/** Shared sector geometry for static spiders and phase animations. */
export function drawPhaseSector(ctx, x, y, phase, { scale = 1, start = 0 } = {}) {
  if (!(phase > 0)) return;
  const angle = -Math.PI / 2 + start * Math.PI / 2;
  ctx.fillStyle = ZX_COLORS.ink; ctx.beginPath(); ctx.moveTo(x, y);
  ctx.arc(x, y, PHASE_RADIUS * scale, angle, angle + phase * Math.PI / 2);
  ctx.closePath(); ctx.fill();
}

/** Fractional turns use the static glyph convention; a full turn leaves a filled spider. */
export function drawDiagramNode(ctx, kind, x, y, { scale = 1, phase = 0 } = {}) {
  ctx.fillStyle = ZX_COLORS[kind];
  if (kind === 'h') ctx.fillRect(x - 13 * scale, y - 13 * scale, 26 * scale, 26 * scale);
  else {
    ctx.beginPath(); ctx.arc(x, y, RADIUS * scale, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = ZX_COLORS.ink; ctx.lineWidth = 1.5 * scale; ctx.stroke();
    drawPhaseSector(ctx, x, y, (phase % 4 + 4) % 4, { scale });
  }
}

/** Clean, worker-compatible canvas counterpart for still images and replay frames. */
export function drawDiagram(ctx, diagram, rect, { positions, width, height, layout: suppliedLayout } = {}) {
  const layout = suppliedLayout || diagramLayout(diagram, { positions, width, height }), scale = Math.min(rect.width / layout.width, rect.height / layout.height);
  ctx.save(); ctx.translate(rect.x + (rect.width - layout.width * scale) / 2, rect.y + (rect.height - layout.height * scale) / 2); ctx.scale(scale, scale);
  ctx.strokeStyle = ZX_COLORS.wire; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  for (const edge of layout.edges) { ctx.beginPath(); ctx.moveTo(edge.a.x, edge.a.y); ctx.quadraticCurveTo(edge.control.x, edge.control.y, edge.b.x, edge.b.y); ctx.stroke(); }
  for (const node of diagram.nodes) if (node.kind !== 'boundary') {
    const { x, y } = layout.positions.get(node.id);
    drawDiagramNode(ctx, node.kind, x, y, { phase: node.phase });
  }
  ctx.restore(); return layout;
}
