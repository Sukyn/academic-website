import test from 'node:test';
import assert from 'node:assert/strict';
import { circuitMetrics, structuralDistance, catalogueMetrics } from '../../tools/circuit-reduction/diversity.mjs';

const reflect = circuit => [...circuit].reverse().map(row => row.map(cell => ({ ZU: 'ZD', ZD: 'ZU', XU: 'XD', XD: 'XU' })[cell] ?? cell));
const reverse = circuit => circuit.map(row => [...row].reverse());
const pad = circuit => circuit.map(row => ['.', ...row.flatMap(cell => [cell, '.']), '.']);
const circuit = [
  ['H', 'ZU', 'X', '.', '.', '.'],
  ['.', 'XD', '.', 'ZU', 'H', '.'],
  ['.', '.', '.', 'ZD', '.', 'Z'],
];

test('Structure and local distance ignore spacing, reflection, and time reversal', () => {
  const expected = circuitMetrics(circuit);
  for (const equivalent of [pad(circuit), reflect(circuit), reverse(circuit), pad(reflect(reverse(circuit)))]) {
    assert.deepEqual(circuitMetrics(equivalent), expected);
    assert.equal(structuralDistance(circuit, equivalent), 0);
  }
});

test('Free reordering of operations on disjoint wires does not create diversity', () => {
  const a = [['H', '.', 'ZU'], ['.', 'X', 'ZD']];
  const b = [['.', 'H', 'ZU'], ['X', '.', 'ZD']];
  assert.equal(circuitMetrics(a).structuralKey, circuitMetrics(b).structuralKey);
  assert.equal(structuralDistance(a, b), 0);
  const idle = Array(a[0].length).fill('.');
  const shifted = [idle, ...a, idle];
  assert.equal(circuitMetrics(a).structuralKey, circuitMetrics(shifted).structuralKey);
  assert.equal(structuralDistance(a, shifted), 0);
  assert.equal(structuralDistance(shifted, a), 0);
});

test('Whole wire permutations preserve the roles of connected gates', () => {
  const a = [['H', 'ZU', '.'], ['.', 'XD', 'X'], ['Z', '.', 'ZU'], ['.', '.', 'ZD']];
  const b = [a[2], a[3], a[0], a[1]];
  assert.equal(circuitMetrics(a).structuralKey, circuitMetrics(b).structuralKey);
  assert.equal(structuralDistance(a, b), 0);
});

test('Wire interaction topology and gate order produce actual diversity', () => {
  const chain = [['ZU', '.', 'H', '.'], ['ZD', 'ZU', '.', '.'], ['.', 'ZD', '.', '.']];
  const pair = [['ZU', 'ZU', 'H', '.'], ['ZD', 'ZD', '.', '.'], ['.', '.', '.', '.']];
  assert.notEqual(circuitMetrics(chain).structuralKey, circuitMetrics(pair).structuralKey);
  assert.ok(structuralDistance(chain, pair) > 0);
  const reordered = circuit.map(row => [...row]);
  [reordered[0][0], reordered[0][2]] = [reordered[0][2], reordered[0][0]];
  assert.notEqual(circuitMetrics(circuit).structuralKey, circuitMetrics(reordered).structuralKey);
  const gap = structuralDistance(circuit, reordered);
  assert.ok(gap > 0 && gap <= 1);
  assert.equal(gap, structuralDistance(reordered, circuit));
});

test('The alternating CZ screenshot pattern fails the proposed four-gate limit', () => {
  const braid = length => Array.from({ length: 3 }, (_, row) => Array.from({ length }, (_, col) =>
    row === col % 2 ? 'ZU' : row === col % 2 + 1 ? 'ZD' : '.'));
  const repeated = circuitMetrics(braid(8)), shorter = circuitMetrics(braid(4));
  assert.equal(repeated.gateCount, 8);
  assert.deepEqual(repeated.gateTypes, { CZ: 8 });
  assert.equal(repeated.maxAlternatingCZ, 8);
  assert.equal(repeated.repetitionShare, 1);
  assert.equal(repeated.entropy, 0);
  assert.ok(repeated.maxAlternatingCZ > 4);
  assert.ok(shorter.maxAlternatingCZ <= 4);
  assert.equal(circuitMetrics(braid(5)).maxAlternatingCZ, 5);
});

test('Catalogue statistics collapse cosmetic copies and count actual witness usage', () => {
  const different = circuit.map(row => row.map(cell => cell === 'H' ? 'Z' : cell));
  const entries = [
    { circuit, solution: [{ rule: 'basis-x' }, { rule: 'basis-x' }, { rule: 'arrange' }] },
    { circuit: pad(reflect(circuit)), solution: [{ rule: 'transfer' }] },
    { circuit: different, solution: [{ rule: 'basis-x' }] },
  ];
  const result = catalogueMetrics(entries);
  assert.equal(result.structuralUnique, 2);
  assert.ok(Math.abs(result.effectiveStructural - Math.exp(-(2 / 3 * Math.log(2 / 3) + 1 / 3 * Math.log(1 / 3)))) < 1e-12);
  assert.equal(result.minimumNearestNeighborDistance, 0);
  assert.equal(result.medianNearestNeighborDistance, 0);
  assert.equal(result.ruleUse['basis-x'], 3);
  assert.equal(result.ruleBoards['basis-x'], 2);
  assert.equal(result.ruleUse.transfer, 1);
  assert.equal(result.ruleUse['corner-up'], 0);
  assert.equal(Object.hasOwn(result.ruleUse, 'arrange'), false);
});

test('Empty and short circuits have finite, useful diagnostics', () => {
  const empty = [['.', '.']], h = [['H', '.']], x = [['X', '.']];
  assert.equal(circuitMetrics(empty).entropy, 0);
  assert.equal(circuitMetrics(empty).repetitionShare, 0);
  assert.equal(structuralDistance(empty, empty), 0);
  assert.equal(structuralDistance(h, x), 1);
  assert.equal(catalogueMetrics([]).effectiveStructural, 0);
  assert.equal(catalogueMetrics([{ circuit: h }]).minimumNearestNeighborDistance, null);
  assert.equal(Object.hasOwn(catalogueMetrics([{ circuit: h }]), 'ruleUse'), false);
});

test('Deduplicated nearest-neighbor statistics retain the full sample weighting', () => {
  const variants = [circuit, pad(circuit), ...['X', 'Z'].map(gate =>
    circuit.map(row => row.map(cell => cell === 'H' ? gate : cell)))];
  const expected = variants.map((a, i) => Math.min(...variants.flatMap((b, j) =>
    i === j ? [] : [structuralDistance(a, b)]))).sort((a, b) => a - b);
  const result = catalogueMetrics(variants.map(circuit => ({ circuit })));
  assert.equal(result.minimumNearestNeighborDistance, expected[0]);
  assert.equal(result.medianNearestNeighborDistance, (expected[1] + expected[2]) / 2);
});
