import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, correctionColumns, pathGraph } from '../../src/lib/graph-states/engine.js';
import { simplifyCorrectionColumns } from '../../src/lib/graph-states/clifford.js';
import { circuitTrace, edgeAtPoint, graphPositions, renderCircuit, renderGraph } from '../../src/lib/graph-states/rendering.js';

function dom(context) {
  const original = globalThis.document;
  context.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.className = '';
      this.classList = { add: value => { this.className += ' ' + value; } };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    append(...children) { for (const child of children) this.appendChild(child); }
    replaceChildren(...children) {
      this.children = [];
      for (const child of children) for (const entry of child.tagName === '#fragment' ? child.children : [child]) this.appendChild(entry);
    }
  }
  globalThis.document = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), createDocumentFragment: () => new Node('#fragment') };
  return tag => new Node(tag);
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);

test('touch selection follows the nearest visible edge at crossings and near shared vertices', () => {
  const graph = { vertices: 8, edges: [[0, 4], [1, 5], [4, 5], [4, 6]] };
  for (const size of [280, 480]) {
    const points = graphPositions(graph.vertices).map(({ x, y }) => ({ x: x * size / 320, y: y * size / 320 }));
    for (const edge of graph.edges) {
      const [a, b] = edge.map(vertex => points[vertex]);
      // A noncentral point avoids an exactly coincident crossing of two lines.
      assert.deepEqual(edgeAtPoint(graph, .6 * a.x + .4 * b.x, .6 * a.y + .4 * b.y, size), edge);
    }
    const [a, b] = [points[4], points[5]];
    assert.deepEqual(edgeAtPoint(graph, (a.x + b.x) / 2, (a.y + b.y) / 2, size), [4, 5]);
    assert.equal(edgeAtPoint(graph, 0, 0, size), null);
  }
});

test('graph labels keep the same separated positions through every rewrite', () => {
  for (let vertices = 3; vertices <= 8; vertices++) {
    const points = graphPositions(vertices);
    assert.equal(points.length, vertices);
    for (const { x, y } of points) assert.ok(x >= 28 && x <= 292 && y >= 28 && y <= 292);
    for (let u = 0; u < vertices; u++) for (let v = u + 1; v < vertices; v++) {
      assert.ok(Math.hypot(points[u].x - points[v].x, points[u].y - points[v].y) > 56);
    }
    assert.deepEqual(graphPositions(applyMove(pathGraph(vertices), { vertex: 1 }).vertices), points);
  }
});

test('graph controls use native labelled buttons, with nodes above edge hit areas', context => {
  const create = dom(context), board = create('div'), graph = pathGraph(5);
  renderGraph(board, graph);
  const buttons = board.children.filter(node => node.tagName === 'button');
  assert.equal(buttons.length, graph.vertices + graph.edges.length);
  assert.ok(buttons.every(button => button.type === 'button' && button.disabled === false && button.attributes['aria-label']));
  assert.deepEqual(buttons.slice(0, 4).map(button => button.dataset.edge), ['0:1', '1:2', '2:3', '3:4']);
  assert.deepEqual(buttons.slice(4).map(button => button.dataset.vertex), ['0', '1', '2', '3', '4']);
  assert.ok(buttons.every(button => !/NaN|Infinity/.test(Object.values(button.style).join(' '))));
  renderGraph(board, graph, { locked: true, highlight: { vertex: 2 } });
  assert.ok(board.children.filter(node => node.tagName === 'button').every(button => button.disabled));
  assert.ok(board.children.find(node => node.dataset.vertex === '2').className.includes('is-highlighted'));
  renderGraph(board, graph, { interactive: false });
  assert.equal(descendants(board).filter(node => node.tagName === 'button').length, 0);
  assert.deepEqual(descendants(board).filter(node => node.tagName === 'text').map(node => node.textContent), ['1', '2', '3', '4', '5']);
});

test('compact correction trace respects intermediate pivot neighbours and review boundaries', () => {
  const initial = pathGraph(5), moves = [{ vertex: 2 }, { edge: [1, 2] }, { vertex: 0 }], saved = structuredClone(initial);
  let expected = initial;
  const columns = [];
  moves.forEach((move, step) => {
    columns.push(...correctionColumns(expected, move));
    expected = applyMove(expected, move);
    assert.deepEqual(circuitTrace(initial, moves, step + 1), { graph: expected, columns: simplifyCorrectionColumns(initial.vertices, columns) });
  });
  assert.deepEqual(circuitTrace(initial, moves, 0), { graph: initial, columns: [] });
  assert.deepEqual(initial, saved);
  assert.ok(circuitTrace(initial, moves).columns.length <= 3);
});

test('compact circuit fits three columns and uses vector phase gates at every review step', context => {
  const create = dom(context), scroll = create('div'), svg = create('svg'); scroll.appendChild(svg); scroll.scrollLeft = 17;
  const graph = pathGraph(4), moves = [{ vertex: 1 }, { edge: [1, 2] }];
  renderCircuit(svg, graph, moves, { activeStep: 1 });
  assert.ok(descendants(svg).some(node => node.textContent === '|G₀⟩'));
  assert.deepEqual(descendants(svg).filter(node => node.attributes.class === 'graph-wire-label').map(node => node.textContent), ['1', '2', '3', '4']);
  assert.equal(descendants(svg).some(node => node.attributes.class === 'graph-wire-node'), false,
    'Correction wire numbers stay plain rather than resembling graph vertices.');
  assert.equal(scroll.scrollLeft, 17);
  assert.ok(descendants(svg).filter(node => node.attributes.class === 'graph-correction-column').length <= 3);
  assert.equal(descendants(svg).filter(node => node.attributes['data-gate'] === 'H').length, 2);
  assert.equal(descendants(svg).filter(node => node.attributes['data-gate'] === 'SDG').length, 2);
  assert.ok(descendants(svg).filter(node => node.tagName === 'line').every(node => node.attributes.y1 === node.attributes.y2));
  renderCircuit(svg, graph, moves, { follow: true });
  assert.equal(scroll.scrollLeft, 0);
  assert.ok(descendants(svg).filter(node => node.attributes.class === 'graph-correction-column').length <= 3);
  for (const phase of descendants(svg).filter(node => ['S', 'SDG'].includes(node.attributes['data-gate']))) {
    assert.ok(phase.children.some(node => node.tagName === 'path'));
    assert.ok(phase.children.every(node => node.tagName !== 'text'));
  }
  assert.ok(descendants(svg).some(node => node.attributes.fill === '#f2d572'), 'H retains the shared yellow square.');
});
