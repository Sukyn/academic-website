import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
async function load(path) {
  const { outputText } = ts.transpileModule(await read(path), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { createConstruction, Field } = await load('../src/lib/circuits/circuit-engine.ts');
const generateCircuit = (q, k, algorithm, depth, metadata, borrowed = 0) =>
  createConstruction(q, k, algorithm, metadata, borrowed).generate(depth);
const { layoutCircuit, circuitTikz, elementLabel } = await load('../src/lib/circuits/circuit-drawing.ts');
const fields = JSON.parse(await read('../src/lib/circuits/fields.json'));
const references = JSON.parse(await read('./circuit-references.json'));

test('80 exact Python circuits and 240 input/output examples', () => {
  for (const f of references) {
    const circuit = generateCircuit(f.q, f.k, f.algorithm, f.max_rec, fields[f.q], f.borrowed);
    const label = `${f.q}/${f.k}/${f.algorithm}/${f.max_rec}/${f.borrowed}`;
    assert.equal(createHash('sha256').update(JSON.stringify(circuit)).digest('hex'), f.sha256, label);
    assert.equal(circuit.operations.length, f.gate_count, label);
    const field = new Field(f.q, fields[f.q]);
    for (const example of f.examples) {
      const values = [...example.input];
      for (const g of circuit.operations) {
        if (g.op === 'add') {
          const delta = g.controls.reduce((a, wire) => field.mul(a, values[wire]), g.coefficient);
          values[g.target] = field.add(values[g.target], delta);
        } else if (g.op === 'scale') values[g.wire] = field.mul(values[g.wire], g.coefficient);
        else values[g.wire] = values[g.wire] === g.a ? g.b : values[g.wire] === g.b ? g.a : values[g.wire];
      }
      assert.deepEqual(values, example.output, label);
    }
  }
});

test('the slider ends at the first complete expansion', () => {
  for (const q of [5, 7, 25]) for (const k of [1, 2, 5, 8, 12]) {
    for (const algorithm of ['divide-and-conquer', 'borrow', 'borrow-and-conquer']) {
      const construction = createConstruction(q, k, algorithm, fields[q]);
      const depth = construction.maxDepth;
      assert.deepEqual(construction.generate(depth), construction.generate(null));
      if (depth) assert(construction.generate(depth - 1).operations
        .some(g => g.op === 'add' && g.controls.length > 1));
    }
  }
});

test('an oversized expansion leaves its construction reusable', () => {
  const construction = createConstruction(125, 20, 'borrow', fields[125]);
  const before = construction.generate(1);
  assert.throws(() => construction.generate(null), /12,000/);
  assert.deepEqual(construction.generate(1), before);
  assert.equal(construction.generate(0).operations.length, 1);
});

test('wrapping and TikZ preserve every operation and wire', () => {
  const circuit = generateCircuit(25, 5, 'borrow-and-conquer', 1, fields[25]);
  for (const width of [240, 375, 1080]) {
    const panels = layoutCircuit(circuit, 5, width);
    assert(panels.length > 1);
    const kinds = panels.flatMap(p => p.nodes.filter(n => ['cplus', 'cbox', 'cswap'].includes(n.style)).map(n => n.style));
    assert.deepEqual(kinds, circuit.operations.map(g => ({ add: 'cplus', scale: 'cbox', swap: 'cswap' })[g.op]));
    for (const panel of panels) {
      assert(panel.width <= width);
      assert.equal(panel.nodes.filter(n => n.style === 'cinput').length, circuit.wire_count);
      for (const edge of panel.edges) assert(panel.nodes[edge.from] && panel.nodes[edge.to]);
    }
    const tikz = circuitTikz(panels, circuit, 5);
    assert(tikz.includes('\\pgfsetlayers{edgelayer,nodelayer,main}'));
    assert.equal((tikz.match(/\\node /g) || []).length, panels.reduce((sum, p) => sum + p.nodes.length, 0));
    assert.equal((tikz.match(/\\begin\{tikzpicture\}/g) || []).length, panels.length);
    assert(tikz.includes('alpha is a root'));
  }
});

test('continuous layout keeps every operation in one row', () => {
  const circuit = generateCircuit(25, 5, 'borrow-and-conquer', 1, fields[25]);
  const panels = layoutCircuit(circuit, 5);
  assert.equal(panels.length, 1);
  assert(panels[0].width > 1200);
  assert.equal(panels[0].nodes.filter(n => ['cplus', 'cbox', 'cswap'].includes(n.style)).length,
    circuit.operations.length);
  assert(panels[0].nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('coefficients sit opposite the nearest control', () => {
  const circuit = { q: 5, wire_count: 3, operations: [
    { op: 'add', controls: [0], target: 2, coefficient: 3 },
    { op: 'add', controls: [2], target: 0, coefficient: 3 },
  ] };
  const nodes = layoutCircuit(circuit, 5, 500)[0].nodes;
  const labels = nodes.filter(n => n.style === 'ccoeff');
  const targets = nodes.filter(n => n.style === 'cplus');
  assert(labels[0].y > targets[0].y);
  assert(labels[1].y < targets[1].y);
  assert.deepEqual(elementLabel(9, 5), { text: 'α-1', tex: '\\alpha-1' });
});

test('invalid and oversized expansions fail explicitly', () => {
  assert.throws(() => generateCircuit(5, 33, 'borrow', 0, fields[5]), /32/);
  assert.throws(() => generateCircuit(25, 5, 'simple_polarization', 1, fields[25]), /at most 4/);
  assert.throws(() => generateCircuit(125, 20, 'borrow', null, fields[125]), /12,000/);
});
