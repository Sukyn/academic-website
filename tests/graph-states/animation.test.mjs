import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, pathGraph } from '../../src/lib/graph-states/engine.js';
import { animateGraphMove, graphMoveStages, COMPLEMENT_DURATION } from '../../src/lib/graph-states/animation.js';
import { GRAPH_NODE_RADIUS, graphPositions } from '../../src/lib/graph-states/rendering.js';

function animationDom(context, reducedMotion = false) {
  const original = globalThis.document, callbacks = new Map();
  let time = 0, nextFrame = 0, writes = 0;
  const view = {
    performance: { now: () => time },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame(callback) { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(frame) { callbacks.delete(frame); },
  };
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.className = '';
      this.ownerDocument = document;
      const changeClass = (value, add) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        if (add) values.add(value); else values.delete(value);
        this.className = [...values].join(' ');
      };
      this.classList = {
        add: value => changeClass(value, true), remove: value => changeClass(value, false),
        toggle: (value, add) => changeClass(value, add),
      };
    }
    setAttribute(name, value) { writes++; this.attributes[name] = String(value); if (name === 'class') this.className = String(value); }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
    replaceChildren(...children) {
      this.children = [];
      for (const child of children) for (const entry of child.tagName === '#fragment' ? child.children : [child]) this.appendChild(entry);
    }
    remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    querySelectorAll(selector) {
      return descendants(this).filter(node => {
        if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
        const match = /^\[data-vertex="(\d+)"\]$/.exec(selector);
        return match ? node.dataset.vertex === match[1] : node.tagName === selector;
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  globalThis.document = {
    defaultView: view,
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), createDocumentFragment: () => new Node('#fragment'),
  };
  context.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  return {
    board: new Node('div'), pending: () => callbacks.size, writes: () => writes,
    advance(now) {
      time = now;
      const pending = [...callbacks.values()]; callbacks.clear();
      for (const callback of pending) callback(now);
    },
  };
}

const graph = { vertices: 4, edges: [[0, 1], [0, 2], [0, 3], [1, 2]] };
const length = line => Math.hypot(line.attributes.x2 - line.attributes.x1, line.attributes.y2 - line.attributes.y1);

test('animation stages toggle every neighbour pair once and use updated pivot neighbourhoods', () => {
  for (let vertices = 3; vertices <= 8; vertices++) {
    let initial = pathGraph(vertices);
    for (let turn = 0; turn < vertices; turn++) {
      initial = applyMove(initial, { vertex: turn });
      for (const move of [{ vertex: turn }, { edge: initial.edges[0] }, { edge: initial.edges[0].toReversed() }]) {
        const saved = structuredClone(initial), stages = graphMoveStages(initial, move);
        assert.equal(stages.length, move.edge ? 3 : 1);
        let expected = initial;
        for (const stage of stages) {
          assert.deepEqual(stage.before, expected);
          assert.equal(stage.pairs.length, stage.neighbours.length * (stage.neighbours.length - 1) / 2);
          assert.equal(new Set(stage.pairs.map(({ edge }) => edge.join(':'))).size, stage.pairs.length);
          for (const { edge: [u, v], existed } of stage.pairs) {
            assert.ok(stage.neighbours.includes(u) && stage.neighbours.includes(v));
            assert.equal(existed, stage.before.edges.some(([a, b]) => a === u && b === v));
            assert.equal(stage.after.edges.some(([a, b]) => a === u && b === v), !existed);
          }
          expected = applyMove(expected, { vertex: stage.vertex });
          assert.deepEqual(stage.after, expected);
        }
        assert.deepEqual(expected, applyMove(initial, move));
        assert.deepEqual(initial, saved);
        assert.notEqual(stages[0].before, initial);
      }
    }
  }
  assert.throws(() => graphMoveStages(pathGraph(3), { edge: [0, 2] }), RangeError);
  assert.throws(() => graphMoveStages(pathGraph(3), { vertex: 3 }), RangeError);
  assert.equal(graphMoveStages(pathGraph(3), { vertex: 0 })[0].pairs.length, 0);
});

test('local complementation grows missing edges and erases existing edges toward their midpoint', async context => {
  const { board, advance, pending } = animationDom(context);
  const animation = animateGraphMove(board, graph, { vertex: 0 });
  assert.equal(board.dataset.animationPhase, 'pulse');
  assert.equal(board.dataset.animationVertex, '0');
  assert.ok(board.querySelectorAll('button').every(node => node.disabled));
  advance(COMPLEMENT_DURATION * .1);
  const dots = board.querySelectorAll('.graph-animation-dot');
  assert.equal(dots.length, 3);
  assert.ok(dots.every(dot => Number(dot.attributes.opacity) === 1));
  assert.ok(dots.every(dot => Number.isFinite(Number(dot.attributes.cx)) && Number.isFinite(Number(dot.attributes.cy))));
  advance(COMPLEMENT_DURATION * .25);
  assert.equal(board.dataset.animationPhase, 'neighbours');
  assert.equal(board.querySelectorAll('.is-affected').length, 3);
  assert.ok(dots.every(dot => Number(dot.attributes.opacity) === 0));
  advance(COMPLEMENT_DURATION * .30);
  assert.equal(board.dataset.animationPhase, 'rewrite');
  assert.equal(board.querySelectorAll('.graph-line').filter(line => line.style.visibility === 'hidden').length, 1);
  const appearing = board.querySelectorAll('.is-appearing'), removing = board.querySelectorAll('.is-removing');
  assert.equal(appearing.length, 4, 'Two missing edges, each drawn from both ends.');
  assert.equal(removing.length, 2, 'One existing edge, with no parallel copy.');
  assert.equal(board.querySelectorAll('.graph-animation-edge').length, 6);
  const starts = appearing.map(line => [line.attributes.x1, line.attributes.y1]);
  const middles = removing.map(line => [line.attributes.x2, line.attributes.y2]);
  const fullHalfLength = length(removing[0]);
  assert.ok(fullHalfLength > 0);
  assert.deepEqual(middles[0], middles[1]);
  assert.ok(appearing.every(line => length(line) === 0 && line.attributes.opacity === '0'));
  assert.ok(removing.every(line => line.attributes.opacity === '1'));
  advance(COMPLEMENT_DURATION * .5);
  const growingLengths = appearing.map(length), shrinkingLengths = removing.map(length);
  assert.ok(growingLengths.every(value => value > 0));
  assert.ok(shrinkingLengths.every(value => value > 0 && value < fullHalfLength));
  assert.deepEqual(appearing.map(line => [line.attributes.x1, line.attributes.y1]), starts, 'Added edges stay attached to their vertices.');
  assert.deepEqual(removing.map(line => [line.attributes.x2, line.attributes.y2]), middles, 'Removed edges remain joined at the midpoint.');
  advance(COMPLEMENT_DURATION * .85);
  assert.equal(board.dataset.animationPhase, 'rewrite');
  assert.ok(appearing.every((line, index) => length(line) > growingLengths[index]));
  assert.ok(removing.every((line, index) => length(line) > 0 && length(line) < shrinkingLengths[index]));
  advance(COMPLEMENT_DURATION * .95);
  assert.ok(removing.every(line => length(line) === 0 && line.attributes.opacity === '0'));
  for (let index = 0; index < appearing.length; index += 2) {
    assert.deepEqual([appearing[index].attributes.x2, appearing[index].attributes.y2], [appearing[index + 1].attributes.x2, appearing[index + 1].attributes.y2], 'New halves meet at the same midpoint.');
  }
  advance(COMPLEMENT_DURATION);
  assert.equal(await animation.finished, true);
  assert.equal(pending(), 0);
  assert.equal(board.querySelectorAll('.graph-animation').length, 0);
  assert.equal(board.querySelectorAll('.is-source').length, 0);
  assert.equal(board.querySelectorAll('.is-affected').length, 0);
  assert.ok(board.querySelectorAll('.graph-line').every(line => !line.style.visibility));
  assert.equal(board.dataset.animationPhase, undefined);
  assert.equal(board.dataset.animationVertex, undefined);
  animation.cancel();
  assert.equal(await animation.finished, true);
});

test('motion begins outside opaque vertices and updates only visible moving endpoints', async context => {
  const { board, advance, writes } = animationDom(context);
  const animation = animateGraphMove(board, graph, { vertex: 0 });
  const positions = graphPositions(graph.vertices), halves = board.querySelectorAll('.graph-animation-edge');
  const pairs = graphMoveStages(graph, { vertex: 0 })[0].pairs;
  pairs.forEach(({ edge }, index) => edge.forEach((vertex, end) => {
    const line = halves[2 * index + end], point = positions[vertex];
    assert.ok(Math.abs(Math.hypot(line.attributes.x1 - point.x, line.attributes.y1 - point.y) - GRAPH_NODE_RADIUS) < 1e-8);
  }));
  const pulseWrites = writes();
  advance(COMPLEMENT_DURATION * .1);
  assert.equal(writes() - pulseWrites, 2 * 3, 'The pulse updates only its three moving dots');
  advance(COMPLEMENT_DURATION * .25);
  const neighbourWrites = writes();
  advance(COMPLEMENT_DURATION * .26); advance(COMPLEMENT_DURATION * .29);
  assert.equal(writes(), neighbourWrites, 'Neighbour highlights need no repeated SVG writes');
  advance(COMPLEMENT_DURATION * .4);
  const rewriteWrites = writes();
  advance(COMPLEMENT_DURATION * .45);
  assert.equal(writes() - rewriteWrites, 2 * halves.length, 'Only the two moving coordinates of each half change');
  advance(COMPLEMENT_DURATION * .95);
  const finalWrites = writes();
  advance(COMPLEMENT_DURATION * .97);
  assert.equal(writes(), finalWrites, 'The final hold does not redraw finished geometry');
  advance(COMPLEMENT_DURATION);
  assert.equal(await animation.finished, true);
});

test('pivot gives each of its three complementations the same uncompressed timing', async context => {
  const { board, advance, pending } = animationDom(context), move = { edge: [0, 1] };
  const stages = graphMoveStages(graph, move), animation = animateGraphMove(board, graph, move);
  for (let index = 0; index < 3; index++) {
    advance(index * COMPLEMENT_DURATION);
    assert.equal(board.dataset.animationVertex, String(stages[index].vertex));
    assert.equal(board.dataset.animationPhase, 'pulse');
    assert.equal(board.querySelectorAll('.graph-line').length, stages[index].before.edges.length);
    assert.equal(board.querySelectorAll('.graph-animation-dot').length, stages[index].neighbours.length);
    assert.equal(board.querySelectorAll('.graph-animation').length, 1);
    advance((index + .5) * COMPLEMENT_DURATION);
    assert.equal(board.dataset.animationVertex, String(stages[index].vertex));
    assert.equal(board.dataset.animationPhase, 'rewrite');
  }
  advance(3 * COMPLEMENT_DURATION - 1);
  assert.equal(pending(), 1, 'The pivot keeps its full duration until the last complementation ends.');
  advance(3 * COMPLEMENT_DURATION);
  assert.equal(await animation.finished, true);
  assert.equal(pending(), 0);
});

test('cancellation clears a partial stage and cannot schedule any later updates', async context => {
  const { board, advance, pending } = animationDom(context);
  const animation = animateGraphMove(board, graph, { vertex: 0 });
  advance(COMPLEMENT_DURATION * .5);
  animation.cancel(); animation.cancel();
  assert.equal(await animation.finished, false);
  assert.equal(pending(), 0);
  assert.equal(board.querySelectorAll('.graph-animation').length, 0);
  assert.equal(board.querySelectorAll('.is-source').length, 0);
  assert.equal(board.querySelectorAll('.is-affected').length, 0);
  assert.ok(board.querySelectorAll('.graph-line').every(line => !line.style.visibility));
  advance(COMPLEMENT_DURATION * 2);
  assert.equal(pending(), 0);
  assert.equal(board.dataset.animationPhase, undefined);
});

test('reduced motion completes immediately without creating an animation or frame', async context => {
  const { board, pending } = animationDom(context, true);
  const animation = animateGraphMove(board, graph, { vertex: 0 });
  assert.equal(await animation.finished, true);
  assert.equal(board.children.length, 0);
  assert.equal(pending(), 0);
  animation.cancel();
  assert.equal(await animation.finished, true);
});
