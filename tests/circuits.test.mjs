import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
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
const { layoutCircuit, circuitTikz, panelSvg } = await load('../src/lib/circuits/circuit-drawing.ts');
const fields = JSON.parse(await read('../src/lib/circuits/fields.json'));
const references = JSON.parse(await read('./circuit-references.json'));

const coefficientLabel = (value, p) => layoutCircuit({ q: p, wire_count: 2, operations: [
  { op: 'add', controls: [0], target: 1, coefficient: value },
] }, p)[0].nodes.find(node => node.style === 'ccoeff').label;

function evaluateCircuit(circuit, field, input) {
  const values = [...input];
  for (const gate of circuit.operations) {
    if (gate.op === 'add') values[gate.target] = field.add(values[gate.target],
      gate.controls.reduce((a, wire) => field.mul(a, values[wire]), gate.coefficient));
    else if (gate.op === 'scale') values[gate.wire] = field.mul(values[gate.wire], gate.coefficient);
    else values[gate.wire] = values[gate.wire] === gate.a ? gate.b : values[gate.wire] === gate.b ? gate.a : values[gate.wire];
  }
  return values;
}

test('80 exact Python circuits and 240 input/output examples', () => {
  for (const f of references) {
    const circuit = generateCircuit(f.q, f.k, f.algorithm, f.max_rec, fields[f.q], f.borrowed);
    const label = `${f.q}/${f.k}/${f.algorithm}/${f.max_rec}/${f.borrowed}`;
    assert.equal(createHash('sha256').update(JSON.stringify(circuit)).digest('hex'), f.sha256, label);
    assert.equal(circuit.operations.length, f.gate_count, label);
    const field = new Field(f.q, fields[f.q]);
    for (const example of f.examples) {
      assert.deepEqual(evaluateCircuit(circuit, field, example.input), example.output, label);
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
  assert.deepEqual(coefficientLabel(9, 5), { text: 'α-1', tex: '\\alpha-1' });
});

test('invalid and oversized expansions fail explicitly', () => {
  assert.throws(() => generateCircuit(5, 33, 'borrow', 0, fields[5]), /32/);
  assert.throws(() => generateCircuit(25, 5, 'simple_polarization', 1, fields[25]), /at most 4/);
  assert.throws(() => generateCircuit(125, 20, 'borrow', null, fields[125]), /12,000/);
});

test('all checked-in fields obey the finite-field identities', () => {
  let seed = 0x12345678;
  const next = q => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % q; };
  for (const [size, metadata] of Object.entries(fields)) {
    const q = Number(size), field = new Field(q, metadata);
    for (let a = 0; a < q; a++) {
      assert.equal(field.add(a, field.neg(a)), 0, `${q}: additive inverse of ${a}`);
      assert.equal(field.mul(a, 0), 0);
      assert.equal(field.mul(a, 1), a);
      if (a) assert.equal(field.mul(a, field.inv(a)), 1, `${q}: multiplicative inverse of ${a}`);
    }
    for (let i = 0; i < 64; i++) {
      const a = next(q), b = next(q), c = next(q);
      assert.equal(field.mul(a, field.add(b, c)), field.add(field.mul(a, b), field.mul(a, c)), `${q}: distributivity`);
      assert.equal(field.mul(a, field.mul(b, c)), field.mul(field.mul(a, b), c), `${q}: associativity`);
    }
  }
});

test('partial and complete constructions restore controls and borrowed wires', () => {
  let seed = 20261014;
  const next = q => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % q; };
  for (const q of [5, 7, 25]) for (const k of [2, 3, 5]) {
    const field = new Field(q, fields[q]);
    for (const algorithm of ['simple_polarization', 'divide-and-conquer', 'borrow', 'borrow-and-conquer']) {
      if (algorithm === 'simple_polarization' && k > Math.min(field.p - 1, q - 2)) continue;
      const construction = createConstruction(q, k, algorithm, fields[q], 1);
      for (const depth of [0, 1, null]) {
        const circuit = construction.generate(depth);
        for (let trial = 0; trial < 6; trial++) {
          const input = Array.from({ length: circuit.wire_count }, () => next(q));
          const expected = [...input];
          expected[k] = field.add(input[k], input.slice(0, k).reduce((a, b) => field.mul(a, b), 1));
          assert.deepEqual(evaluateCircuit(circuit, field, input), expected, `${q}/${k}/${algorithm}/${depth}: restore every non-target wire`);
        }
      }
    }
  }
});

test('malformed field metadata cannot allocate unbounded tables or enter a cycle', () => {
  for (const q of [undefined, null, '5', NaN, Infinity, -1, 0, 4, 257, 1e9]) {
    assert.throws(() => new Field(q, fields[5]), /prime power/);
  }
  for (const metadata of [undefined, null, {}, { characteristic: 9, primitive: 2 },
    { characteristic: 5, primitive: 5 }, { characteristic: 5, primitive: 1, modulus: [1, 4, 2] },
    { characteristic: 5, primitive: 5, modulus: [1, 0, 0] },
    { characteristic: 5, primitive: 5, modulus: [1, 0, 1] },
    { characteristic: 5, primitive: 5, modulus: [2, 4, 2] },
    { characteristic: 5, primitive: 5, modulus: [1, 5, 2] },
    { characteristic: 5, primitive: 5, modulus: [1, .5, 2] },
    { characteristic: 5, primitive: 5, modulus: 'bad' }]) {
    assert.throws(() => new Field(25, metadata));
  }
  assert.throws(() => new Field(7, { characteristic: 7, primitive: 2 }), /primitive/);
  assert.deepEqual(new Field(5, { ...fields[5], unused: ['extra data'] }).metadata, fields[5]);
  const metadata = structuredClone(fields[25]);
  const construction = createConstruction(25, 3, 'borrow-and-conquer', metadata);
  const before = construction.generate(1);
  metadata.primitive = 1;
  metadata.modulus.fill(0);
  assert.deepEqual(construction.generate(1), before, 'A prepared construction owns its field basis');
});

test('field labels reject inputs that never finish reducing', () => {
  for (const [value, p] of [[-1, 5], [Infinity, 5], [1.5, 5], [1, 1], [1, 0], [1, NaN], [1, 257]]) {
    assert.throws(() => coefficientLabel(value, p), /field label/);
  }
  assert.deepEqual(coefficientLabel(2 ** 12, 2), { text: 'α¹²', tex: '\\alpha^{12}' });
});

test('the circuit worker rejects malformed messages and recovers after errors', async () => {
  const replies = [], self = { postMessage: response => replies.push(response) };
  const source = (await read('../src/scripts/circuit-worker.ts')).replace(/^import[^\n]*\n/gm, '');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(outputText, { self, fields, createConstruction, Error });
  const valid = { id: 1, q: 5, k: 5, algorithm: 'borrow-and-conquer', depth: 1 };
  const send = data => { self.onmessage({ data }); return replies.at(-1); };
  const first = send(valid);
  assert.equal(first.id, valid.id);
  assert.equal(first.circuit.q, 5);
  for (const data of [null, undefined, false, [], 'bad', {},
    { ...valid, id: NaN }, { ...valid, id: -1 }, { ...valid, q: '5' },
    { ...valid, q: '__proto__' }, { ...valid, q: 1e9 }, { ...valid, k: 33 },
    { ...valid, algorithm: 'toString' }, { ...valid, depth: NaN },
    { ...valid, depth: Infinity }, { ...valid, depth: -1 }, { ...valid, depth: .5 }]) {
    assert.doesNotThrow(() => send(data));
    assert.equal(typeof replies.at(-1).error, 'string');
    assert.equal(replies.at(-1).circuit, undefined);
  }
  assert.deepEqual(send({ ...valid, id: 2 }).circuit, first.circuit, 'Invalid requests do not poison the cached construction');
  const capped = send({ ...valid, id: 3, depth: Number.MAX_SAFE_INTEGER });
  assert.equal(capped.depth, capped.maxDepth);
  assert.equal(send({ ...valid, id: 4, q: 125, k: 20, algorithm: 'borrow', depth: 100 }).error.includes('12,000'), true);
  assert.equal(send({ ...valid, id: 5, q: 125, k: 20, algorithm: 'borrow', depth: 0 }).circuit.operations.length, 1);
});

test('the circuit controller recovers from worker failures and ignores obsolete work', async () => {
  class Element {
    value = ''; hidden = false; disabled = false; textContent = ''; innerHTML = ''; clientWidth = 640;
    attributes = new Map(); listeners = new Map();
    addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]); }
    async dispatch(name, event = {}) { for (const callback of this.listeners.get(name) ?? []) await callback(event); }
    checkValidity() { return true; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    toggleAttribute(name, enabled) { if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); }
    replaceChildren() { this.innerHTML = ''; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const elements = new Map(['circuit-form', 'dimension', 'controls', 'algorithm', 'depth', 'depth-value', 'copy-tikz',
    'toggle-layout', 'circuit-preview', 'circuit-status', 'field-basis', 'copy-fallback', 'tikz-code'].map(id => [id, new Element()]));
  const get = id => elements.get(id);
  get('dimension').value = '5'; get('controls').value = '3';
  get('algorithm').value = 'borrow-and-conquer'; get('depth').value = '0';
  get('copy-fallback').hidden = true;
  const window = new Element(), workers = [], timers = new Map();
  let timer = 0, startupFailure = true, postFailure = false;
  class Worker {
    messages = []; terminated = false;
    constructor() { if (startupFailure) throw new Error('Worker blocked'); workers.push(this); }
    postMessage(message) { if (postFailure) throw new Error('Could not send'); this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const clipboard = { writeText: async () => { throw new Error('Clipboard denied'); } };
  const source = (await read('../src/scripts/circuits.ts')).replace(/^import[^\n]*\n/gm, '')
    .replace('import.meta.url', JSON.stringify('https://example.test/circuits/'));
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(outputText, { document: { querySelector: selector => get(selector.slice(1)) }, window,
    navigator: { clipboard }, Worker, URL, layoutCircuit, panelSvg, circuitTikz,
    ResizeObserver: class { observe() {} },
    setTimeout: callback => { timers.set(++timer, callback); return timer; }, clearTimeout: id => timers.delete(id) });
  const flush = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
  const respond = worker => worker.onmessage({ data: { id: worker.messages.at(-1).id,
    circuit: generateCircuit(5, 3, 'borrow-and-conquer', 0, fields[5]), p: 5, maxDepth: 2, depth: 0 } });

  assert.doesNotThrow(flush, 'A blocked Worker produces an accessible error');
  assert.match(get('circuit-status').textContent, /could not start/);
  assert.equal(get('circuit-preview').attributes.get('aria-busy'), 'false');
  assert.equal(get('copy-tikz').disabled, true);
  startupFailure = false; postFailure = true;
  await get('controls').dispatch('input');
  assert.doesNotThrow(flush, 'Sending failures follow the same recovery path');
  assert.equal(workers.at(-1).terminated, true);
  postFailure = false;
  await get('controls').dispatch('input'); flush();
  const obsolete = workers.at(-1);
  await get('depth').dispatch('input');
  assert.equal(obsolete.terminated, true);
  respond(obsolete);
  assert.equal(get('copy-tikz').disabled, true, 'An obsolete result cannot enable export');
  flush();
  const current = workers.at(-1);
  obsolete.onerror();
  assert.equal(current.terminated, false, 'An obsolete error cannot terminate a replacement worker');
  respond(current);
  assert.equal(get('copy-tikz').disabled, false);
  assert.match(get('circuit-preview').innerHTML, /<svg/);
  await get('copy-tikz').dispatch('click');
  assert.equal(get('copy-fallback').hidden, false);
  assert.equal(get('tikz-code').selected, true);
  assert.match(get('tikz-code').value, /\\begin\{tikzpicture\}/);

  await get('depth').dispatch('input'); flush();
  assert.equal(workers.at(-1), current, 'Completed construction workers are reused');
  current.onmessageerror();
  assert.equal(current.terminated, true);
  assert.equal(get('circuit-preview').innerHTML, '');
  assert.equal(get('copy-tikz').disabled, true);
  await get('controls').dispatch('input'); flush();
  const recovered = workers.at(-1); respond(recovered);
  let finishCopy;
  clipboard.writeText = () => new Promise(resolve => { finishCopy = resolve; });
  const copying = get('copy-tikz').dispatch('click');
  await get('depth').dispatch('input');
  finishCopy(); await copying;
  assert.equal(get('copy-tikz').textContent, 'Copy TikZ', 'A delayed clipboard response cannot overwrite the new round');

  await window.dispatch('pagehide');
  assert.equal(timers.size, 0, 'Navigation cancels pending constructions');
  assert.equal(recovered.terminated, true);
  await window.dispatch('pageshow', { persisted: false });
  assert.equal(timers.size, 0);
  await window.dispatch('pageshow', { persisted: true }); flush();
  const restored = workers.at(-1);
  assert.notEqual(restored, recovered);
  respond(restored);
  assert.equal(get('copy-tikz').disabled, false, 'A back/forward-cache restoration starts a fresh worker');
});
