import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, targetDiagram, validateDiagram } from '../../src/lib/zx-calculus/engine.js';
import { diagramLayout, drawDiagramNode, nodeGlyph, HADAMARD_SIZE, ZX_COLORS } from '../../src/lib/zx-calculus/rendering.js';
import { createRewriteScene, drawRewriteFrame } from '../../src/lib/zx-calculus/animation.js';
import { curvePoint } from '../../src/lib/zx-calculus/wires.js';

const closePoint = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8, `${JSON.stringify(a)} differs from ${JSON.stringify(b)}`);

test('H chains subdivide one spider-to-spider curve without kinks or moving spiders', () => {
  const before = applyMove(targetDiagram(), { rule: 'insert', edge: [0, 2], kind: 'z' });
  const positions = new Map([[0, { x: 36, y: 140 }], [1, { x: 36, y: 280 }], [2, { x: 764, y: 140 }],
    [3, { x: 764, y: 280 }], [4, { x: 400, y: 140 }]]);
  const initial = diagramLayout(before, { positions, width: 800, height: 500 });
  const after = applyMove(applyMove(before, { rule: 'color', nodes: [4] }), { rule: 'color', nodes: [4] });
  const layout = diagramLayout(after, initial), kinds = new Map(after.nodes.map(node => [node.id, node.kind]));
  for (const [id, point] of initial.positions) closePoint(layout.positions.get(id), point);
  for (const route of layout.routes) {
    assert.notEqual(kinds.get(route.ids[0]), 'h'); assert.notEqual(kinds.get(route.ids.at(-1)), 'h');
    for (let index = 1; index < route.ids.length - 1; index++) {
      assert.equal(kinds.get(route.ids[index]), 'h');
      closePoint(layout.positions.get(route.ids[index]), curvePoint(route, route.parameters[index]));
    }
    route.indices.forEach((edgeIndex, index) => {
      const segment = layout.edges[edgeIndex], reversed = after.edges[edgeIndex][0] !== route.ids[index];
      for (const t of [0, .25, .5, .75, 1]) {
        const start = route.parameters[index], end = route.parameters[index + 1];
        closePoint(curvePoint(segment, t), curvePoint(route, reversed ? end + t * (start - end) : start + t * (end - start)));
      }
    });
  }
});

test('SVG and Canvas use the same smaller H box', context => {
  const previous = globalThis.document;
  context.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const element = tag => ({ tag, attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); },
    appendChild(child) { this.children.push(child); return child; } });
  globalThis.document = { createElementNS: (_, tag) => element(tag) };
  const glyph = nodeGlyph('h'), box = glyph.children[0].children[0], calls = [];
  assert.equal(box.tag, 'rect'); assert.equal(Number(box.attributes.width), HADAMARD_SIZE);
  assert.equal(Number(box.attributes.height), HADAMARD_SIZE); assert.ok(HADAMARD_SIZE <= 20);
  drawDiagramNode({ fillRect: (...args) => calls.push(args) }, 'h', 42, 64);
  assert.deepEqual(calls, [[42 - HADAMARD_SIZE / 2, 64 - HADAMARD_SIZE / 2, HADAMARD_SIZE, HADAMARD_SIZE]]);
});

test('a colour change grows its boxes on opaque wires while a roomy route stays fixed', () => {
  const before = { nodes: [...targetDiagram().nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'x' }],
    edges: [[0, 4], [1, 4], [4, 5], [5, 2], [5, 3]] };
  const positions = new Map([[0, { x: 36, y: 120 }], [1, { x: 36, y: 300 }], [2, { x: 764, y: 120 }],
    [3, { x: 764, y: 300 }], [4, { x: 200, y: 120 }], [5, { x: 600, y: 120 }]]);
  const layout = diagramLayout(before, { positions, width: 800, height: 500 });
  const scene = createRewriteScene(before, { rule: 'color', nodes: [4] }, undefined, { layout });
  for (const source of layout.routes) {
    const destination = scene.afterLayout.routes.find(route => route.ids[0] === source.ids[0] && route.ids.at(-1) === source.ids.at(-1));
    closePoint(destination.a, source.a); closePoint(destination.b, source.b); closePoint(destination.control, source.control);
  }
  for (const node of scene.nodes.filter(node => !node.before)) closePoint(node.from, node.to);
  for (const progress of [0, .2, .4, .6, .8, 1]) {
    const wires = [], saved = []; let path;
    const ctx = { globalAlpha: 1,
      save() { saved.push({ globalAlpha: this.globalAlpha, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
      restore() { Object.assign(this, saved.pop()); }, translate() {}, scale() {}, beginPath() { path = []; },
      moveTo(x, y) { path = [x, y]; }, quadraticCurveTo(...args) { path.push(...args); },
      stroke() { if (this.strokeStyle === ZX_COLORS.wire && path.length === 6) wires.push({ path, alpha: this.globalAlpha }); },
      arc() {}, fill() {}, fillRect() {}, closePath() {},
    };
    drawRewriteFrame(ctx, scene, progress, { x: 0, y: 0, width: scene.width, height: scene.height });
    assert.ok(wires.length > 0 && wires.every(wire => wire.alpha === 1), `Wires stay opaque at ${progress}`);
  }
});

function parallelExample() {
  const diagram = validateDiagram({ nodes: [...targetDiagram().nodes, { id: 4, kind: 'z' }, { id: 5, kind: 'x' }],
    edges: [[0, 4], [2, 4], [1, 5], [3, 5], [4, 5], [4, 5], [4, 5]] });
  const positions = new Map([[0, { x: 36, y: 70 }], [1, { x: 36, y: 250 }], [2, { x: 364, y: 70 }],
    [3, { x: 364, y: 250 }], [4, { x: 160, y: 160 }], [5, { x: 240, y: 160 }]]);
  return { diagram, layout: diagramLayout(diagram, { positions, width: 400, height: 400 }) };
}

test('making room for H boxes never merges parallel wires into the same curve', () => {
  let { diagram, layout } = parallelExample();
  for (const id of [4, 5, 4]) {
    diagram = applyMove(diagram, { rule: 'color', nodes: [id] });
    const next = diagramLayout(diagram, layout);
    const parallel = next.routes.filter(route => route.ids[0] === 4 && route.ids.at(-1) === 5);
    assert.equal(parallel.length, 3);
    assert.equal(new Set(parallel.map(route => `${route.control.x.toFixed(6)}:${route.control.y.toFixed(6)}`)).size, 3,
      'All three parallel wires retain distinct routes');
    closePoint(next.positions.get(4), layout.positions.get(4)); closePoint(next.positions.get(5), layout.positions.get(5));
    layout = next;
  }
});

test('colour animations match parallel wires through their surviving H boxes', () => {
  const initial = parallelExample();
  const before = applyMove(initial.diagram, { rule: 'color', nodes: [4] });
  const layout = diagramLayout(before, initial.layout);
  const scene = createRewriteScene(before, { rule: 'color', nodes: [5] }, undefined, { layout });
  assert.ok(scene.colorWires);
  assert.equal(scene.wires.length, 0, 'Full colour routes need no unused raw wire tracks');
  for (const node of scene.nodes.filter(node => node.before?.kind === 'h' && node.slide)) {
    assert.ok(node.slide.wire.from.ids.includes(node.id), 'Each H starts on its own source wire');
    assert.ok(node.slide.wire.to.ids.includes(node.id), 'Each H ends on its own destination wire');
    closePoint(node.from, curvePoint(node.slide.wire.from, node.slide.from));
    closePoint(node.to, curvePoint(node.slide.wire.to, node.slide.to));
  }
});

test('overlapping manually placed spiders keep colour-animation coordinates finite', () => {
  const initial = parallelExample(), before = applyMove(initial.diagram, { rule: 'color', nodes: [4] });
  const positions = new Map(initial.layout.positions);
  positions.set(4, { x: 200, y: 160 }); positions.set(5, { x: 200, y: 160 });
  const layout = diagramLayout(before, { positions, width: 400, height: 400 });
  const scene = createRewriteScene(before, { rule: 'color', nodes: [5] }, undefined, { layout });
  for (const node of scene.nodes) {
    assert.ok([node.from.x, node.from.y, node.to.x, node.to.y].every(Number.isFinite));
    if (node.slide) assert.ok(Number.isFinite(node.slide.from) && Number.isFinite(node.slide.to));
  }
});
