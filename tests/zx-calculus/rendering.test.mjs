import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramLayout, drawDiagram, drawDiagramNode, nodeGlyph, phaseSector, PHASE_RADIUS, renderDiagram, ruleGlyph, updateDiagramPositions, ZX_COLORS } from '../../src/lib/zx-calculus/rendering.js';
import { applyMove } from '../../src/lib/zx-calculus/engine.js';
import { dailyPuzzle } from '../../src/lib/zx-calculus/leaderboard.js';

const identity = { nodes: [0, 1, 2, 3].map(id => ({ id, kind: 'boundary' })), edges: [[0, 2], [1, 3]] };
const sample = {
  nodes: [...identity.nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'x', phase: 3 }, { id: 6, kind: 'h' }],
  edges: [[0, 4], [4, 5], [5, 4], [5, 2], [1, 6], [6, 3]],
};

function dom(context) {
  const previous = globalThis.document;
  context.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; this.classList = { add: name => { this.className += ` ${name}`; } }; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
  }
  globalThis.document = { createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  return tag => new Element(tag);
}
const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);

test('layout is deterministic, keeps boundary order, and separates all internal vertices', () => {
  const saved = structuredClone(sample), layout = diagramLayout(sample);
  assert.deepEqual(diagramLayout(sample), layout);
  assert.deepEqual(sample, saved);
  assert.ok(layout.positions.get(0).x < layout.positions.get(2).x);
  assert.ok(layout.positions.get(0).y < layout.positions.get(1).y);
  assert.equal(layout.positions.get(0).y, layout.positions.get(2).y);
  for (const point of layout.positions.values()) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  const points = sample.nodes.filter(node => node.kind !== 'boundary').map(node => layout.positions.get(node.id));
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) assert.ok(Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) >= 48);
});

test('wide spider neighbourhoods use additional columns instead of a tall stack', () => {
  const nodes = Array.from({ length: 17 }, (_, index) => ({ id: index + 4, kind: index % 2 ? 'z' : 'x' }));
  const diagram = { nodes: [...identity.nodes, ...nodes], edges: [[0, 4], [1, 4], [4, 2], [4, 3], ...nodes.slice(1).map(node => [4, node.id])] };
  const layout = diagramLayout(diagram);
  assert.ok(layout.height <= 400);
  assert.ok(layout.width <= 800);
  const points = nodes.map(node => layout.positions.get(node.id));
  assert.ok(new Set(points.map(point => point.x)).size >= 4);
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) assert.ok(Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) >= 48);
});

test('parallel edges curve on different sides even when their endpoint order differs', () => {
  const { edges } = diagramLayout(sample);
  assert.notDeepEqual(edges[1].midpoint, edges[2].midpoint);
  assert.ok(Math.abs(edges[1].midpoint.x - edges[2].midpoint.x) < 1e-8);
  assert.ok(Math.abs(edges[1].midpoint.y - edges[2].midpoint.y) >= 20);
});

test('50 initial daily diagrams keep wire tap centres reachable beside round node controls', () => {
  for (let day = 0; day < 50; day++) {
    const date = new Date(Date.UTC(2026, 9, 22 + day)).toISOString().slice(0, 10);
    const diagram = dailyPuzzle(date).diagram, layout = diagramLayout(diagram);
    for (const edge of layout.edges) {
      assert.ok(Array.from({ length: 101 }, (_, index) => {
        const t = index / 100, s = 1 - t;
        return { x: s * s * edge.a.x + 2 * s * t * edge.control.x + t * t * edge.b.x,
          y: s * s * edge.a.y + 2 * s * t * edge.control.y + t * t * edge.b.y };
      }).some(point => Math.abs(point.x - edge.hit.x) <= 12 && Math.abs(point.y - edge.hit.y) <= 12),
      `${date}: wire ${edge.index} stays inside its button.`);
      for (const node of diagram.nodes.filter(node => node.kind !== 'boundary')) {
        const point = layout.positions.get(node.id);
        assert.ok(Math.hypot(point.x - edge.hit.x, point.y - edge.hit.y) >= (node.kind === 'h' ? 17 : 23), `${date}: wire ${edge.index} is covered by node ${node.id}.`);
      }
      for (const previous of layout.edges.slice(0, edge.index)) {
        assert.ok(Math.abs(previous.hit.x - edge.hit.x) >= 13 || Math.abs(previous.hit.y - edge.hit.y) >= 13, `${date}: wire ${edge.index} is covered by wire ${previous.index}.`);
      }
    }
  }
});

test('a large parallel-wire fan stays inside the diagram instead of being clipped', () => {
  const diagram = { nodes: [...identity.nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'x' }],
    edges: [[0, 4], [4, 2], [1, 5], [5, 3], ...Array.from({ length: 40 }, () => [4, 5])] };
  const layout = diagramLayout(diagram);
  assert.equal(layout.edges.length, 44);
  for (const edge of layout.edges) for (const point of [edge.a, edge.b, edge.control]) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= 0 && point.x <= layout.width);
    assert.ok(point.y >= 0 && point.y <= layout.height);
  }
  assert.equal(new Set(layout.edges.slice(4).map(edge => edge.control.x)).size, 40);
});

test('positions from the preceding diagram remain stable when nothing changed', () => {
  const initial = diagramLayout(sample), next = diagramLayout(sample, { positions: initial.positions });
  assert.deepEqual(next.positions, initial.positions);
});

test('saved spider and boundary coordinates stay exact while Hadamards stay on their wire', () => {
  const positions = new Map([[0, { x: 24, y: 62 }], [1, { x: 32, y: 167 }], [2, { x: 570, y: 79 }], [3, { x: 592, y: 190 }], [4, { x: 310, y: 102 }], [5, { x: 310, y: 102 }], [6, { x: 415, y: 140 }]]);
  const saved = structuredClone(positions), layout = diagramLayout(sample, { positions, width: 700, height: 360 });
  for (const node of sample.nodes) if (node.kind !== 'h') assert.deepEqual(layout.positions.get(node.id), positions.get(node.id));
  const route = layout.routes.find(route => route.ids.includes(6)), point = layout.positions.get(6);
  assert.ok(Math.abs(point.y - (route.a.y + (route.b.y - route.a.y) * route.parameters[1])) < 1e-8);
  assert.deepEqual(positions, saved);
  assert.equal(layout.width, 700); assert.equal(layout.height, 360);
});

test('only new nodes are placed, near their fixed neighbours and clear of existing nodes', () => {
  const original = diagramLayout(identity), after = applyMove(identity, { rule: 'insert-hh', edge: [0, 2] });
  const layout = diagramLayout(after, original);
  for (const [id, point] of original.positions) assert.deepEqual(layout.positions.get(id), point);
  assert.deepEqual(diagramLayout(after, original), layout);
  for (const id of [4, 5]) {
    const point = layout.positions.get(id);
    assert.equal(point.y, original.positions.get(0).y);
    assert.ok(point.x > original.positions.get(0).x && point.x < original.positions.get(2).x);
    for (const [otherId, other] of layout.positions) if (id !== otherId) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 48);
  }
  const shifted = new Map(layout.positions); shifted.set(5, { x: 900, y: 600 });
  const expanded = diagramLayout(after, { positions: shifted, width: 960, height: 660 });
  const cancelled = diagramLayout(identity, expanded);
  assert.equal(cancelled.width, 960); assert.equal(cancelled.height, 660);
  assert.equal(cancelled.positions.has(5), false, 'Removed coordinates are not kept just to retain canvas size.');
});

test('a dense custom diagram can always place its final allowed node without invalid coordinates', () => {
  const before = { nodes: [...identity.nodes, ...Array.from({ length: 27 }, (_, index) => ({ id: index + 4, kind: 'z' }))], edges: identity.edges };
  const positions = new Map(diagramLayout(identity).positions);
  for (let index = 0; index < 27; index++) positions.set(index + 4, { x: 36 + index % 7 * 48, y: 36 + Math.floor(index / 7) * 48 });
  const saved = diagramLayout(before, { positions }), after = applyMove(before, { rule: 'insert', edge: [0, 2], kind: 'x' });
  const layout = diagramLayout(after, saved), placed = layout.positions.get(31);
  assert.ok(Number.isFinite(placed.x) && Number.isFinite(placed.y));
  assert.ok(layout.width >= saved.width && layout.height >= saved.height);
  for (const [id, point] of saved.positions) {
    assert.deepEqual(layout.positions.get(id), point);
    assert.ok(Math.hypot(placed.x - point.x, placed.y - point.y) >= 48);
  }
});

test('drag redraw reuses the same SVG, symbols and native buttons without losing selection', context => {
  const create = dom(context), container = create('div');
  const initial = renderDiagram(container, sample, { selected: new Set([4]) });
  const children = container.children, elements = descendants(container), button = elements.find(element => element.dataset.node === '4');
  const symbol = elements.find(element => element.attributes['data-zx-node'] === '4');
  const path = elements.find(element => element.attributes['data-zx-edge'] === '0'), oldPath = path.attributes.d;
  const hitPath = elements.find(element => element.attributes['data-edge-hit'] === '0');
  assert.equal(hitPath.attributes['stroke-width'], '24');
  assert.equal(hitPath.attributes.d, oldPath);
  const positions = new Map(initial.positions); positions.set(4, { x: initial.positions.get(4).x + 35, y: initial.positions.get(4).y + 24 });
  const moved = updateDiagramPositions(container, sample, { positions, width: initial.width, height: initial.height });
  assert.equal(container.children, children);
  assert.deepEqual(descendants(container), elements);
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(symbol.attributes.transform, `translate(${positions.get(4).x} ${positions.get(4).y})`);
  assert.notEqual(path.attributes.d, oldPath);
  assert.equal(hitPath.attributes.d, path.attributes.d);
  assert.equal(button.style.left, `${positions.get(4).x / moved.width * 100}%`);
  for (const [id, point] of positions) assert.deepEqual(moved.positions.get(id), point);
});

test('a wire detours around an unrelated spider instead of appearing connected to it', () => {
  const diagram = {
    nodes: [...identity.nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'h' }, { id: 6, kind: 'x' }],
    edges: [[0, 4], [4, 6], [6, 2], [1, 5], [5, 3]],
  };
  const positions = new Map([[0, { x: 36, y: 86 }], [1, { x: 36, y: 172 }], [2, { x: 364, y: 86 }], [3, { x: 364, y: 172 }], [4, { x: 200, y: 64.5 }], [5, { x: 200, y: 129 }], [6, { x: 200, y: 193.5 }]]);
  const layout = diagramLayout(diagram, { positions }), wire = layout.edges[1], middle = layout.positions.get(5);
  assert.ok(Math.hypot(wire.midpoint.x - middle.x, wire.midpoint.y - middle.y) >= 24);
});

test('diagram controls use labelled native buttons and do not make boundary wires selectable as nodes', context => {
  const create = dom(context), container = create('div');
  renderDiagram(container, sample, { selected: new Set([4]) });
  const buttons = descendants(container).filter(node => node.tag === 'button');
  assert.equal(buttons.length, sample.edges.length + 3);
  assert.ok(buttons.every(node => node.type === 'button' && node.attributes['aria-label'] && !node.disabled));
  assert.deepEqual(buttons.filter(node => node.dataset.node).map(node => node.dataset.node), ['4', '5', '6']);
  assert.equal(buttons.find(node => node.dataset.node === '4').attributes['aria-pressed'], 'true');
  assert.equal(buttons.find(node => node.dataset.node === '4').attributes['aria-label'], 'Green spider, no turn');
  assert.equal(buttons.find(node => node.dataset.node === '5').attributes['aria-label'], 'Red spider, three-quarter turn');
  assert.equal(descendants(container).filter(node => node.attributes['data-edge-hit'] !== undefined).length, sample.edges.length);
  renderDiagram(container, sample, { locked: true });
  assert.ok(descendants(container).filter(node => node.tag === 'button').every(node => node.disabled));
  assert.equal(descendants(container).filter(node => node.attributes['data-edge-hit'] !== undefined).length, sample.edges.length);
  renderDiagram(container, sample, { interactive: false });
  assert.equal(descendants(container).filter(node => node.tag === 'button').length, 0);
  assert.equal(descendants(container).filter(node => node.attributes['data-edge-hit'] !== undefined).length, 0);
  assert.equal(descendants(container).filter(node => node.tag === 'text').length, 0);
  assert.equal(descendants(container).filter(node => node.attributes.class === 'zx-phase-sector').length, 1);
});

test('all rule thumbnails have actual colored symbols and no font-dependent gate characters', context => {
  dom(context);
  for (const rule of ['fusion', 'identity', 'hh', 'color', 'hopf']) {
    const glyph = ruleGlyph(rule);
    assert.equal(glyph.attributes['aria-hidden'], 'true');
    assert.ok(descendants(glyph).some(node => ['circle', 'rect'].includes(node.tag)));
    assert.equal(descendants(glyph).filter(node => node.tag === 'text').length, 0);
  }
  const hadamard = nodeGlyph('h');
  assert.ok(descendants(hadamard).some(node => node.tag === 'rect' && node.attributes.fill === ZX_COLORS.h));
});

test('reversible equations reuse their diagram for either direction', context => {
  dom(context);
  const body = glyph => glyph.children.slice(1).map(({ tag, attributes }) => ({ tag, attributes }));
  for (const rule of ['fusion', 'identity', 'hh', 'hopf']) {
    const equation = ruleGlyph(rule), forward = ruleGlyph(rule, { direction: 1 }), reverse = ruleGlyph(rule, { direction: -1 });
    assert.equal(equation.children[0].attributes.d, 'M72 28H90M77 23L72 28L77 33M85 23L90 28L85 33');
    assert.equal(forward.children[0].attributes.d, 'M72 28H90M85 23L90 28L85 33');
    assert.equal(reverse.children[0].attributes.d, 'M72 28H90M77 23L72 28L77 33');
    assert.deepEqual(body(forward), body(equation));
    assert.deepEqual(body(reverse), body(equation));
  }
});

test('colour change always points toward newly added Hadamards', context => {
  dom(context);
  for (const direction of [0, 1, -1]) {
    const glyph = ruleGlyph('color', { direction });
    assert.equal(glyph.children[0].attributes.d, 'M72 28H90M85 23L90 28L85 33');
    const boxes = descendants(glyph).filter(node => node.tag === 'rect');
    assert.equal(boxes.length, 3);
    assert.ok(boxes.every(box => Number(box.attributes.x) > 100), 'Hadamards are produced on the right of the arrow');
  }
});

test('selected wires are visibly highlighted and remain selected through drag redraw', context => {
  const create = dom(context), container = create('div');
  const layout = renderDiagram(container, sample, { selectedEdge: 1 });
  const elements = descendants(container), paths = elements.filter(element => element.attributes['data-zx-edge'] !== undefined);
  const buttons = elements.filter(element => element.dataset.edge !== undefined);
  assert.deepEqual(paths.map(path => path.attributes.stroke), sample.edges.map((_, index) => index === 1 ? ZX_COLORS.selection : ZX_COLORS.wire));
  assert.deepEqual(buttons.map(button => button.attributes['aria-pressed']), sample.edges.map((_, index) => String(index === 1)));
  const positions = new Map(layout.positions); positions.set(4, { x: layout.positions.get(4).x + 20, y: layout.positions.get(4).y + 15 });
  updateDiagramPositions(container, sample, { positions, width: layout.width, height: layout.height });
  assert.equal(paths[1].attributes.stroke, ZX_COLORS.selection);
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  renderDiagram(container, sample);
  assert.ok(descendants(container).filter(element => element.attributes['data-zx-edge'] !== undefined).every(path => path.attributes.stroke === ZX_COLORS.wire));
});

test('canvas rendering uses the same curves and phase sectors without needing a document or fonts', () => {
  const paths = [], circles = [];
  const ctx = { save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {}, stroke() {}, fill() {}, arc(...args) { circles.push(args); }, fillRect() {}, quadraticCurveTo(...points) { paths.push(points); } };
  const layout = drawDiagram(ctx, sample, { x: 20, y: 10, width: 800, height: 450 });
  assert.equal(paths.length, sample.edges.length);
  assert.deepEqual(paths, layout.edges.map(edge => [edge.control.x, edge.control.y, edge.b.x, edge.b.y]));
  assert.deepEqual(circles.filter(circle => circle[2] === PHASE_RADIUS), [[layout.positions.get(5).x, layout.positions.get(5).y, PHASE_RADIUS, -Math.PI / 2, Math.PI]]);
  assert.equal(drawDiagram(ctx, identity, { x: 0, y: 0, width: 100, height: 60 }).positions.size, 4);
});

test('each phase uses matching clockwise SVG sectors, canvas arcs, glyphs and accessible turns in both colours', context => {
  const create = dom(context);
  for (const kind of ['z', 'x']) for (let phase = 0; phase < 4; phase++) {
    const node = { id: 4, kind, phase }, diagram = { nodes: [...identity.nodes, node], edges: [[0, 4], [4, 2], [1, 3]] };
    const container = create('div'), layout = renderDiagram(container, diagram);
    const symbols = descendants(container), sectors = symbols.filter(element => element.attributes.class === 'zx-phase-sector');
    assert.equal(sectors.length, phase ? 1 : 0);
    assert.equal(symbols.filter(element => element.tag === 'text').length, 0);
    assert.ok(sectors.every(sector => sector.attributes.d === phaseSector(phase).path && sector.attributes.fill === ZX_COLORS.ink));
    assert.equal(descendants(nodeGlyph(kind, phase)).filter(sector => sector.attributes.class === 'zx-phase-sector').length, phase ? 1 : 0);
    const name = `${kind === 'z' ? 'Green' : 'Red'} spider, ${phaseSector(phase).label}`;
    assert.equal(symbols.find(element => element.dataset.node === '4').attributes['aria-label'], name);
    const circles = [], ctx = { save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {}, moveTo() {}, stroke() {}, fill() {}, arc(...args) { circles.push(args); }, quadraticCurveTo() {} };
    drawDiagram(ctx, diagram, { x: 0, y: 0, width: 400, height: 216 });
    const point = layout.positions.get(4);
    assert.deepEqual(circles.filter(circle => circle[2] === PHASE_RADIUS), phase ? [[point.x, point.y, PHASE_RADIUS, phaseSector(phase).startAngle, phaseSector(phase).endAngle]] : []);
  }
});

test('animated fractional turns sweep clockwise and reset after a complete turn', () => {
  const arcs = [], ctx = { beginPath() {}, closePath() {}, moveTo() {}, stroke() {}, fill() {}, arc(...args) { arcs.push(args); } };
  for (const phase of [0, .5, 1.5, 2.5, 3.5, 4, 4.5, 6]) {
    arcs.length = 0; drawDiagramNode(ctx, 'z', 20, 30, { phase, scale: 2 });
    const sectors = arcs.filter(arc => arc[2] === PHASE_RADIUS * 2), turn = phase % 4;
    assert.deepEqual(sectors, turn ? [[20, 30, PHASE_RADIUS * 2, -Math.PI / 2, (turn - 1) * Math.PI / 2]] : []);
  }
  assert.equal(phaseSector(4), phaseSector(0));
  assert.match(phaseSector(3).path, /0 1 1 -10 0Z$/);
});
