import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, applyMove, cloneCircuit, validateCircuit } from '../../src/lib/circuit-reduction/engine.js';
import { REWRITE_DURATION, createRewriteTransition, transitionSample } from '../../src/lib/circuit-reduction/transition.js';

function fixture(rule) {
  const circuit = cloneCircuit(rule.left);
  let row = 0;
  if (circuit[0].some(cell => cell.endsWith('D'))) {
    circuit.unshift(circuit[0].map(cell => cell.endsWith('D') ? 'ZU' : '.'));
    row++;
  }
  if (circuit.at(-1).some(cell => cell.endsWith('U'))) circuit.push(circuit.at(-1).map(cell => cell.endsWith('U') ? 'ZD' : '.'));
  // Padding also makes it possible to verify that unrelated glyphs stay out.
  circuit.forEach((line, index) => { line.unshift(index === 0 ? 'H' : '.'); line.push('.'); });
  validateCircuit(circuit);
  const move = { rule: rule.id, row, column: 1 };
  return { circuit, move, after: applyMove(circuit, move) };
}

const ordered = items => items.map(item => JSON.stringify(item)).sort();
function expectedScope(before, after, rule, move) {
  const cells = new Set();
  for (const circuit of [before, after]) for (let row = move.row; row < move.row + rule.left.length; row++) for (let column = move.column; column < move.column + rule.left[0].length; column++) {
    cells.add(`${row}:${column}`);
    if (circuit[row][column].endsWith('U')) cells.add(`${row + 1}:${column}`);
    if (circuit[row][column].endsWith('D')) cells.add(`${row - 1}:${column}`);
  }
  return circuit => [...cells].map(key => {
    const [row, column] = key.split(':').map(Number);
    return { row, column, cell: circuit[row][column] };
  }).filter(item => item.cell !== '.');
}

test('all twenty rules and their reverse preserve exactly the glyphs and adjacent links in scope', () => {
  assert.equal(RULES.length, 20);
  for (const rule of RULES) {
    const { circuit, move, after } = fixture(rule), saved = structuredClone([circuit, after, move]);
    for (const [before, next] of [[circuit, after], [after, circuit]]) {
      const plan = createRewriteTransition(before, next, move), expected = expectedScope(before, next, rule, move);
      assert.ok(plan, rule.id);
      for (const [source, progress, excluded, column] of [[before, 0, 'in', 'fromColumn'], [next, 1, 'out', 'toColumn']]) {
        const gates = plan.gates.filter(item => item.phase !== excluded).map(item => ({ row: item.row, column: item[column], cell: item.cell }));
        assert.deepEqual(ordered(gates), ordered(expected(source)), `${rule.id}: exact glyphs at ${progress}`);
        const links = plan.links.filter(item => item.phase !== excluded).map(item => ({ row: item.row, column: item[column] }));
        assert.deepEqual(ordered(links), ordered(expected(source).filter(item => item.cell.endsWith('U')).map(({ row, column }) => ({ row, column }))), `${rule.id}: exact links at ${progress}`);
      }
      for (const item of [...plan.gates, ...plan.links]) for (const progress of [0, .2, .5, .8, 1]) {
        const sample = transitionSample(item, progress);
        assert.ok(Number.isFinite(sample.column));
        assert.ok(sample.opacity >= 0 && sample.opacity <= 1);
        assert.ok(sample.scale > 0 && sample.scale <= 1);
      }
      for (const link of plan.links.filter(item => item.phase === 'move')) {
        assert.ok(link.row >= 0 && link.row + 1 < before.length, 'Every connector joins adjacent wires');
        for (const row of [link.row, link.row + 1]) {
          assert.ok(plan.gates.some(gate => gate.row === row && gate.phase === 'move' && gate.fromColumn === link.fromColumn && gate.toColumn === link.toColumn), `${rule.id}: both endpoints follow a moving link`);
        }
      }
    }
    assert.deepEqual([circuit, after, move], saved);
  }
});

test('HH, XX and ZZ cancellation pairs meet, shrink and fade; the reverse emerges from that midpoint', () => {
  assert.equal(REWRITE_DURATION, 400);
  for (const cell of ['H', 'X', 'Z']) {
    const before = [[cell, cell]], after = [['.', '.']], move = { rule: `cancel-${cell.toLowerCase()}`, row: 0, column: 0 };
    const out = createRewriteTransition(before, after, move).gates;
    const incoming = createRewriteTransition(after, before, move).gates;
    assert.equal(out.length, 2); assert.equal(incoming.length, 2);
    assert.deepEqual(out.map(item => item.toColumn), [.5, .5]);
    assert.deepEqual(incoming.map(item => item.fromColumn), [.5, .5]);
    for (let index = 0; index < 2; index++) {
      assert.equal(transitionSample(out[index], 0).opacity, 1);
      assert.equal(transitionSample(out[index], 1).opacity, 0);
      assert.ok(transitionSample(out[index], .6).scale < 1);
      assert.ok(transitionSample(out[index], .6).opacity < 1);
      for (const progress of [0, .25, .5, .75, 1]) {
        const forward = transitionSample(out[index], progress), backward = transitionSample(incoming[index], 1 - progress);
        for (const key of ['column', 'scale', 'opacity']) assert.ok(Math.abs(forward[key] - backward[key]) < 1e-12);
      }
    }
  }
});

test('basis changes retain linked partners outside the window and corner connector changes crossfade', () => {
  for (const id of ['basis-up', 'basis-down']) {
    const rule = RULES.find(item => item.id === id), { circuit, after, move } = fixture(rule);
    const plan = createRewriteTransition(circuit, after, move);
    const outside = plan.gates.filter(gate => gate.row < move.row || gate.row >= move.row + rule.left.length);
    assert.equal(outside.length, 1);
    assert.equal(outside[0].phase, 'move');
    assert.equal(outside[0].fromColumn, outside[0].toColumn);
    assert.deepEqual(plan.links.map(item => item.phase).sort(), ['in', 'out']);
  }
  const rule = RULES.find(item => item.id === 'corner-down'), { circuit, after, move } = fixture(rule);
  const plan = createRewriteTransition(circuit, after, move);
  assert.equal(plan.links.filter(item => item.phase === 'move').length, 0, 'A stationary top and sliding bottom crossfade their connectors');
  assert.equal(plan.links.filter(item => item.phase === 'in').length, 2);
  assert.equal(plan.links.filter(item => item.phase === 'out').length, 2);
});

test('layout operations, invalid snapshots and unchanged circuits have no rewrite transition', () => {
  const circuit = [['X', 'X']], move = { rule: 'cancel-x', row: 0, column: 0 };
  assert.equal(createRewriteTransition(circuit, circuit, move), null);
  assert.equal(createRewriteTransition(circuit, [['.', '.']], { ...move, rule: 'arrange' }), null);
  assert.equal(createRewriteTransition(circuit, [['.', '.']], { ...move, rule: 'unknown' }), null);
  assert.equal(createRewriteTransition(circuit, [['.', '.', '.']], move), null);
  assert.equal(createRewriteTransition(circuit, [['X', '.']], move), null);
  assert.equal(createRewriteTransition([['H', 'X', 'X']], [['.', '.', '.']], { ...move, column: 1 }), null);
  assert.equal(createRewriteTransition(null, null, move), null);
  const item = { fromColumn: 1, toColumn: 2, phase: 'move' };
  assert.deepEqual(transitionSample(item, -1), { column: 1, opacity: 1, scale: 1 });
  assert.deepEqual(transitionSample(item, 2), { column: 2, opacity: 1, scale: 1 });
});
