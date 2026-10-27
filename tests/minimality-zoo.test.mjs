import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { importTheory, parseTheoryFile } from '../src/lib/minimality/zoo.js';
import { LIMITS, createTheory, addGenerator, addRule, placeGate, controlCircuit, serializeDraft, exportTheory } from '../src/lib/minimality/model.js';

const directory = new URL('./fixtures/minimality/zoo/', import.meta.url);
const fixture = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const presentation = lhs => ({ name: 'Routing', generators: { CNOT: 2 }, equations: [{ id: 'Rule', lhs, rhs: { id: lhs.wires ?? lhs.perm?.length ?? 0 } }] });

function execute(operations, input) {
  let bits = [...input];
  for (const operation of operations) {
    if (operation.perm) bits = operation.perm.map(index => bits[index]);
    else {
      assert.equal(operation.gen, 'CNOT');
      const [control, target] = operation.on;
      bits[target] ^= bits[control];
    }
  }
  return bits;
}

function bitStrings(wires) {
  return Array.from({ length: 2 ** wires }, (_, value) => Array.from({ length: wires }, (_, wire) => (value >> wire) & 1));
}

function inlineMacros(source) {
  const renamed = new Map(Object.keys(source.macros ?? {}).map((name, index) => [name, `\u0001macro${index}`]));
  const terms = value => Array.isArray(value) ? value.map(terms) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'macro' ? renamed.get(entry) : terms(entry)])) : value;
  return { ...source, macros: Object.fromEntries(Object.entries(source.macros ?? {}).map(([name, body]) => [renamed.get(name), terms(body)])),
    equations: terms(source.equations) };
}

// Track routing symbolically, then commute only gates on disjoint wires.
function circuitTrace({ wires, ops }) {
  let permutation = Array.from({ length: wires }, (_, wire) => wire);
  const operations = [];
  for (const operation of ops) {
    if (operation.perm) permutation = operation.perm.map(wire => permutation[wire]);
    else operations.push({ gen: operation.gen, on: operation.on.map(wire => permutation[wire]) });
  }
  const remaining = operations.map((operation, index) => ({ operation, index,
    predecessors: new Set(operations.slice(0, index).flatMap((earlier, before) => earlier.on.some(wire => operation.on.includes(wire)) ? [before] : [])) }));
  const ordered = [];
  while (remaining.length) {
    const next = remaining.filter(entry => !entry.predecessors.size).sort((a, b) =>
      JSON.stringify(a.operation).localeCompare(JSON.stringify(b.operation), 'en'))[0];
    ordered.push(next.operation);
    remaining.splice(remaining.indexOf(next), 1);
    for (const entry of remaining) entry.predecessors.delete(next.index);
  }
  return { permutation, operations: ordered };
}

function sourceCircuit(term, theory) {
  const indices = wires => Array.from({ length: wires }, (_, wire) => wire);
  const embed = (body, selected, wires) => body.ops.map(operation => {
    if (!operation.perm) return { gen: operation.gen, on: operation.on.map(wire => selected[wire]) };
    const perm = indices(wires);
    for (const [wire, input] of operation.perm.entries()) perm[selected[wire]] = selected[input];
    return { perm };
  });
  let result;
  if (Object.hasOwn(term, 'wires')) {
    result = { wires: term.wires, ops: term.ops.flatMap(({ on, ...operation }) => {
      const body = sourceCircuit(operation, theory);
      return embed(body, Number.isInteger(on) ? [on] : on ?? indices(body.wires), term.wires);
    }) };
  } else if (Object.hasOwn(term, 'gen')) {
    const definition = theory.generators[term.gen], wires = typeof definition === 'number' ? definition : definition.type;
    result = { wires, ops: [{ gen: term.gen, on: indices(wires) }] };
  } else if (Object.hasOwn(term, 'macro')) result = sourceCircuit(theory.macros[term.macro], theory);
  else if (Object.hasOwn(term, 'id')) result = { wires: term.id, ops: [] };
  else if (Object.hasOwn(term, 'perm')) result = { wires: term.perm.length, ops: [{ perm: term.perm }] };
  else {
    const parts = (term.compose ?? term.tensor).map(part => sourceCircuit(part, theory));
    if (term.compose) result = { wires: parts[0].wires, ops: parts.flatMap(part => part.ops) };
    else {
      const wires = parts.reduce((sum, part) => sum + part.wires, 0);
      let offset = 0;
      result = { wires, ops: parts.flatMap(part => {
        const selected = indices(part.wires).map(wire => wire + offset);
        offset += part.wires;
        return embed(part, selected, wires);
      }) };
    }
  }
  return { wires: result.wires, ops: Array.from({ length: term.repeat ?? 1 }, () => result.ops).flat() };
}

test('the frozen official zoo has nine editable presentations and explains the remaining editor bounds', () => {
  const compatible = [], disabled = [];
  const names = readdirSync(directory).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 24);
  for (const name of names) {
    try {
      const draft = importTheory(fixture(name));
      assert.equal(draft.structure, 'PROP');
      assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
      compatible.push(name);
    } catch (error) {
      assert.equal(error instanceof RangeError, true, `${name}: ${error}`);
      assert.match(error.message, /at most 24|whole number from 0 to 6|expansion limit|editor's (64-gate|16-column) limit/, name);
      disabled.push(name);
    }
  }
  assert.deepEqual(compatible, [
    'affine_simplified_d5.json', 'clifford_cs.json', 'clifford_t.json', 'linear_phase_simplified_d5.json',
    'multi_qudit_clifford_d3.json',
    'quadratic_phase_simplified_d5.json', 'qubit_clifford.json', 'qutrit_clifford.json', 'real_clifford.json',
  ]);
  assert.equal(disabled.length, 15);
});

test('Qubit Clifford imports its exact generators, eight rule labels, scalar phases, and fixed wire counts', () => {
  const source = fixture('qubit_clifford.json'), before = JSON.stringify(source);
  const draft = importTheory(source);
  assert.deepEqual(draft.generators.map(({ id, name, arity }) => [id, name, arity]), [
    ['g1', 'omega', 0], ['g2', 'H', 1], ['g3', 'S', 1], ['g4', 'CNOT', 2],
  ]);
  assert.deepEqual(draft.rules.map(({ name, wires }) => [name, wires]), [
    ['omega8', 0], ['H2', 1], ['S4', 1], ['E', 1], ['CPh', 2], ['B', 2], ['CZ', 2], ['I', 3],
  ]);
  assert.deepEqual(draft.rules.map(rule => [rule.left.length, rule.right.length]), [
    [8, 0], [2, 0], [4, 0], [3, 4], [3, 1], [4, 2], [3, 5], [5, 2],
  ]);
  assert.deepEqual(draft.rules[0].left.map(({ wire, column }) => [wire, column]), Array.from({ length: 8 }, (_, column) => [0, column]));
  const phase = draft.rules[3].right.filter(operation => operation.generator === 'g1');
  assert.equal(phase.length, 1);
  assert.equal(phase[0].wire, 0);
  assert.equal(draft.rules[5].left.filter(operation => operation.generator === '$swap').length, 2);
  assert.equal(draft.rules[7].left.filter(operation => operation.generator === '$swap').length, 2);
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
  assert.deepEqual(importTheory(source), draft, 'Editor IDs are deterministic');
  assert.equal(JSON.stringify(source), before);
  const exported = exportTheory(draft);
  assert.equal(exported.structure, 'PROP');
  assert.deepEqual(Object.keys(exported.generators), ['omega', 'H', 'S', 'CNOT']);
  assert.equal(Object.hasOwn(exported, 'wire_dimension'), false);
  assert.equal(Object.hasOwn(exported.generators.H, 'matrix'), false);
});

test('compact Qubit Clifford and Clifford+CS saves are over 60 percent smaller without changing the editable theory', () => {
  for (const name of ['qubit_clifford.json', 'clifford_cs.json']) {
    const draft = importTheory(fixture(name));
    const legacy = JSON.stringify(draft), compact = serializeDraft(draft);
    assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(legacy) * .4, name);
    assert.deepEqual(parseTheoryFile(legacy), draft);
    assert.deepEqual(parseTheoryFile(compact), draft);
  }
});

test('official Clifford macros become named editable definitions while preserving the original presentation', () => {
  const cases = [
    ['qubit_clifford.json', ['Z', 'X', 'S_dagger', 'omega_dagger']],
    ['real_clifford.json', ['X']],
    ['qutrit_clifford.json', ['K', 'H3', 'S_dagger', 'S_prime', 'Z', 'X']],
    ['clifford_cs.json', ['Z', 'X', 'S_dagger', 'omega_dagger', 'CNOT']],
    ['multi_qudit_clifford_d3.json', ['H2', 'H3', 'S_inv', 'Z', 'X', 'M_g', 'CZ_inv', 'CX', 'CX_inv']],
    ['quadratic_phase_simplified_d5.json', ['CZ']],
  ];
  for (const [filename, names] of cases) {
    const source = fixture(filename), before = JSON.stringify(source), draft = importTheory(source), exported = exportTheory(draft);
    assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), names, filename);
    assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.id), names.map((_, index) => `s${index + 1}`), filename);
    assert.deepEqual(draft.generators.map(generator => generator.name), Object.keys(source.generators), filename);
    assert.deepEqual(draft.rules.map(rule => rule.name), source.equations.map(equation => equation.id), filename);
    assert.deepEqual(Object.keys(exported.generators), Object.keys(source.generators), filename);
    assert.equal(exported.equations.length, source.equations.length, filename);
    for (const [index, equation] of source.equations.entries()) {
      for (const [input, output] of [['lhs', 'lhs'], ['rhs', 'rhs']]) {
        assert.deepEqual(circuitTrace(exported.equations[index][output]), circuitTrace(sourceCircuit(equation[input], source)),
          `${filename}, ${equation.id}, ${input}`);
      }
    }
    const records = [...draft.shortcuts, ...draft.rules];
    const ids = [...draft.generators, ...records, ...records.flatMap(record => [...record.left, ...record.right])].map(record => record.id);
    assert.equal(new Set(ids).size, ids.length, `${filename}: IDs are unique across definitions and equations`);
    assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft, filename);
    assert.equal(JSON.stringify(source), before, filename);
    if (!['quadratic_phase_simplified_d5.json', 'multi_qudit_clifford_d3.json'].includes(filename)) {
      const inlined = exportTheory(importTheory(inlineMacros(source)));
      for (const [index, equation] of exported.equations.entries()) {
        assert.deepEqual(circuitTrace(equation.lhs), circuitTrace(inlined.equations[index].lhs), filename);
        assert.deepEqual(circuitTrace(equation.rhs), circuitTrace(inlined.equations[index].rhs), filename);
      }
    }
  }
  const qubit = importTheory(fixture('qubit_clifford.json'));
  const byName = new Map(qubit.shortcuts.map(shortcut => [shortcut.name, shortcut]));
  assert.equal(byName.get('X').left[1].generator, byName.get('Z').id);
  const calls = qubit.rules.flatMap(rule => [...rule.left, ...rule.right]).map(operation => operation.generator);
  assert.ok(calls.includes(byName.get('S_dagger').id));
  assert.ok(!calls.includes(byName.get('X').id), 'Useful unused definitions remain available in the editor');
  assert.equal(byName.get('omega_dagger').wires, 0);
  assert.equal(byName.get('omega_dagger').left.length, 7);
});

test('Qubit Clifford+T retains all equations with nested CH definitions and bounded primitive expansion', () => {
  const source = fixture('clifford_t.json'), before = JSON.stringify(source);
  const draft = importTheory(source), exported = exportTheory(draft);
  assert.deepEqual(draft.generators.map(generator => generator.name), ['omega', 'H', 'T', 'CNOT']);
  assert.deepEqual(draft.rules.map(rule => rule.name), source.equations.map(equation => equation.id));
  assert.equal(draft.rules.length, 11);
  assert.deepEqual(Object.keys(exported.generators), Object.keys(source.generators));
  assert.equal(exported.equations.length, 11);
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), [
    'S', 'S_dagger', 'Z', 'X', 'T_dagger', 'CX0', 'CH', 'CH0', 'CS', 'CS_dagger', 'pT', 'pT_dagger',
  ]);
  const shortcuts = new Map(draft.shortcuts.map(shortcut => [shortcut.name, shortcut]));
  const names = new Map([...draft.generators, ...draft.shortcuts].map(entry => [entry.id, entry.name]));
  const body = name => shortcuts.get(name).left.map(operation => names.get(operation.generator));
  assert.deepEqual(body('CH'), ['S', 'H', 'T', 'CNOT', 'T_dagger', 'H', 'S_dagger']);
  assert.deepEqual(body('CH0'), ['X', 'CH', 'X']);
  assert.deepEqual(body('CS_dagger'), ['CS', 'CS', 'CS']);
  assert.equal(draft.rules.some(rule => [...rule.left, ...rule.right].some(operation => operation.generator === shortcuts.get('CS_dagger').id)), false,
    'An unused nested definition remains available without consuming an equation');
  assert.equal(shortcuts.has('pT0'), false, 'The unused thirteenth alias stays outside the existing shortcut limit');
  const hth = draft.rules.find(rule => rule.name === 'HTH');
  for (const side of ['left', 'right']) {
    assert.equal(hth[side].length, 10);
    assert.equal(Math.max(...hth[side].map(operation => operation.column)), 9);
    assert.equal(hth[side].filter(operation => operation.generator === '$swap').length, 4);
  }
  const expandedHth = exported.equations.find(equation => equation.id === 'HTH');
  assert.equal(expandedHth.lhs.ops.length, 106);
  assert.equal(expandedHth.rhs.ops.length, 106);
  assert.equal(LIMITS.gates, 64);
  assert.equal(LIMITS.columns, 16);
  assert.equal(LIMITS.shortcuts, 12);
  assert.ok(expandedHth.lhs.ops.length <= LIMITS.expandedGates);
  for (const [index, equation] of source.equations.entries()) {
    for (const side of ['lhs', 'rhs']) {
      assert.deepEqual(circuitTrace(exported.equations[index][side]), circuitTrace(sourceCircuit(equation[side], source)),
        `${equation.id}, ${side}: shortcut expansion preserves every primitive operation and its ordered wires`);
    }
  }
  const records = [...draft.shortcuts, ...draft.rules];
  const ids = [...draft.generators, ...records, ...records.flatMap(record => [...record.left, ...record.right])].map(record => record.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const record of records) for (const side of ['left', 'right']) {
    assert.ok(record[side].length <= LIMITS.gates);
    assert.ok(record[side].every(operation => operation.column < LIMITS.columns));
  }
  const saved = serializeDraft(draft);
  assert.ok(Buffer.byteLength(saved) <= LIMITS.bytes);
  assert.deepEqual(parseTheoryFile(saved), draft);
  assert.equal(JSON.stringify(source), before);
});

test('whole multiwire macro calls route correctly on reversed and nonadjacent placements', () => {
  for (const wires of [2, 3, 4]) {
    for (let control = 0; control < wires; control++) for (let target = 0; target < wires; target++) {
      if (control === target) continue;
      const source = { ...presentation({ wires, ops: [{ macro: 'Turn', on: [control, target] }] }),
        macros: { Turn: { compose: [{ gen: 'CNOT' }, { perm: [1, 0] }] } } };
      const draft = importTheory(source), shortcut = draft.shortcuts[0], compiled = exportTheory(draft).equations[0].lhs.ops;
      assert.equal(shortcut.wires, 2);
      assert.equal(draft.rules[0].left.filter(operation => operation.generator === shortcut.id).length, 1);
      for (const bits of bitStrings(wires)) {
        const expected = [...bits];
        expected[target] ^= expected[control];
        [expected[control], expected[target]] = [expected[target], expected[control]];
        assert.deepEqual(execute(compiled, bits), expected, `${wires} wires, Turn(${control}, ${target}), ${bits}`);
      }
    }
  }
});

test('scalar and nested shortcut calls remain named at tensor offsets and expand exactly once for search', () => {
  const source = { name: 'Nested phases', generators: { s: 0, H: 1 }, macros: {
    ph: { gen: 's', repeat: 2 }, pair: { tensor: [{ gen: 'H' }, { gen: 'H' }] },
    body: { tensor: [{ macro: 'ph' }, { macro: 'pair' }] },
  }, equations: [{ id: 'Use', lhs: { tensor: [{ id: 1 }, { macro: 'body' }] }, rhs: { id: 3 } }] };
  const draft = importTheory(source), body = draft.shortcuts.find(shortcut => shortcut.name === 'body');
  assert.deepEqual(draft.shortcuts.map(shortcut => [shortcut.name, shortcut.wires]), [['ph', 0], ['pair', 2], ['body', 2]]);
  assert.deepEqual(body.left.map(operation => operation.generator).sort(), ['s1', 's2']);
  assert.equal(draft.rules[0].left.find(operation => operation.generator === body.id).wire, 1);
  assert.deepEqual(circuitTrace(exportTheory(draft).equations[0].lhs), circuitTrace(sourceCircuit(source.equations[0].lhs, source)));
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
});

test('colliding, invalid, excess, and oversized macro definitions inline without adding presentation data', () => {
  const source = { name: 'Fallbacks', generators: { H: 1 }, macros: { H: { gen: 'H', repeat: 2 },
    'bad\nlabel': { gen: 'H' }, Big: { gen: 'H', repeat: 17 }, many: { gen: 'H', repeat: 65 }, Use: { macro: 'H' } },
    equations: [{ id: 'Use', lhs: { compose: [{ macro: 'Use' }, { macro: 'bad\nlabel' }] }, rhs: { id: 1 } }] };
  const draft = importTheory(source), exported = exportTheory(draft);
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), ['Use']);
  assert.deepEqual(draft.shortcuts[0].left.map(operation => operation.generator), ['g1', 'g1']);
  assert.deepEqual(draft.generators.map(generator => generator.name), ['H']);
  assert.equal(draft.rules.length, 1);
  assert.deepEqual(exported.equations[0].lhs.ops, Array.from({ length: 3 }, () => ({ gen: 'H', on: [0] })));
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
  const excess = { ...source, macros: Object.fromEntries(Array.from({ length: LIMITS.shortcuts + 2 }, (_, index) => [`M${index}`, { gen: 'H' }])),
    equations: [{ id: 'Use last', lhs: { macro: `M${LIMITS.shortcuts + 1}` }, rhs: { id: 1 } }] };
  const limited = importTheory(excess);
  assert.equal(limited.shortcuts.length, LIMITS.shortcuts);
  assert.deepEqual(exportTheory(limited).equations[0].lhs.ops, [{ gen: 'H', on: [0] }]);
  const allInvalid = importTheory(inlineMacros(source));
  assert.equal(Object.hasOwn(allInvalid, 'shortcuts'), false);
  assert.deepEqual(exportTheory(allInvalid), exported);
});

test('source aliases use compact labels while raw macro references and primitive search names remain exact', () => {
  const source = { name: 'Alias routing', generators: { CNOT: 2, omega: 0 }, macros: {
    CNOT_zero: { gen: 'CNOT' }, CH_zero: { macro: 'CNOT_zero' }, phase_T: { gen: 'omega' },
    phase_T_dagger: { macro: 'phase_T', repeat: 2 },
  }, equations: [{ id: 'Aliases', lhs: { tensor: [{ macro: 'phase_T_dagger' }, { macro: 'CH_zero' }] }, rhs: { id: 2 } }] };
  const before = JSON.stringify(source), draft = importTheory(source), exported = exportTheory(draft);
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), ['CX0', 'CH0', 'pT', 'pT_dagger']);
  assert.equal(draft.shortcuts[1].left[0].generator, draft.shortcuts[0].id);
  assert.deepEqual(draft.shortcuts[3].left.map(operation => operation.generator), [draft.shortcuts[2].id, draft.shortcuts[2].id]);
  assert.deepEqual(Object.keys(exported.generators), ['CNOT', 'omega']);
  assert.deepEqual(circuitTrace(exported.equations[0].lhs), circuitTrace(sourceCircuit(source.equations[0].lhs, source)));
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
  assert.equal(JSON.stringify(source), before);
});

test('zoo skips colliding rendered macro labels and rejects primitive names that cannot render', () => {
  const source = { name: 'Rendered collisions', generators: { H: 1, omega: 0 }, macros: {
    CH_zero: { gen: 'H' }, CH0: { gen: 'H', repeat: 2 }, 'ω': { gen: 'omega' },
    'H^2': { gen: 'H', repeat: 3 }, Use: { macro: 'CH0' },
  }, equations: [{ id: 'Use', lhs: { macro: 'Use' }, rhs: { gen: 'H', repeat: 2 } }] };
  const draft = importTheory(source);
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), ['CH0', 'Use']);
  assert.deepEqual(exportTheory(draft).equations[0].lhs.ops, [{ gen: 'H', on: [0] }, { gen: 'H', on: [0] }]);
  const primitiveCollision = { ...source, generators: { CH0: 1 }, macros: { CH_zero: { gen: 'CH0' } },
    equations: [{ id: 'Use', lhs: { macro: 'CH_zero' }, rhs: { id: 1 } }] };
  assert.equal(Object.hasOwn(importTheory(primitiveCollision), 'shortcuts'), false);
  assert.deepEqual(Object.keys(exportTheory(importTheory(primitiveCollision)).generators), ['CH0']);
  for (const raw of ['ABCDE', 'H H', '\\x', '🙂', 'H\u200b']) {
    const invalid = { generators: { [raw]: 1 }, equations: [{ id: 'Rule', lhs: { gen: raw }, rhs: { id: 1 } }] };
    assert.throws(() => importTheory(invalid), /must render as 1–4/);
  }
});

test('macro grouping falls back to inline scheduling when whole-register routing would exceed editor bounds', () => {
  const source = { name: 'Wide macro', generators: { H: 1 }, macros: {
    Wide: { wires: 6, ops: [{ gen: 'H', on: 0, repeat: 10 }] },
  }, equations: [{ id: 'Permuted calls', lhs: { wires: 6, ops: [
    { macro: 'Wide', on: [5, 4, 3, 2, 1, 0] },
    { macro: 'Wide', on: [4, 5, 3, 2, 1, 0] },
    { macro: 'Wide', on: [3, 5, 4, 2, 1, 0] },
  ] }, rhs: { id: 6 } }] };
  const draft = importTheory(source), operations = draft.rules[0].left;
  assert.equal(operations.length, 30);
  assert.equal(Math.max(...operations.map(operation => operation.column)), 9);
  assert.deepEqual(draft.generators.map(generator => generator.name), ['H']);
  assert.equal(draft.rules.length, 1);
  assert.deepEqual(circuitTrace(exportTheory(draft).equations[0].lhs), circuitTrace(sourceCircuit(source.equations[0].lhs, source)));
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
});

test('optional shortcut parsing cannot exhaust the validated import budget or block later useful aliases', () => {
  const source = { name: 'Optional parse budget', generators: { H: 1 }, macros: {
    Cost: { tensor: Array.from({ length: 5_000 }, () => ({ id: 0 })) },
    Use: { gen: 'H' },
  }, equations: [{ id: 'Use', lhs: { macro: 'Use' }, rhs: { id: 1 } }] };
  const before = JSON.stringify(source), draft = importTheory(source);
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), ['Use']);
  assert.equal(draft.rules[0].left[0].generator, draft.shortcuts[0].id);
  assert.deepEqual(exportTheory(draft).equations[0].lhs.ops, [{ gen: 'H', on: [0] }]);
  assert.deepEqual(parseTheoryFile(serializeDraft(draft)), draft);
  assert.equal(JSON.stringify(source), before);
});

test('ordered generator placements preserve every CNOT truth table, including reversed and nonadjacent wires', () => {
  for (const wires of [2, 3, 4]) {
    for (let control = 0; control < wires; control++) {
      for (let target = 0; target < wires; target++) {
        if (control === target) continue;
        const draft = importTheory(presentation({ wires, ops: [{ gen: 'CNOT', on: [control, target] }] }));
        const compiled = exportTheory(draft).equations[0].lhs.ops;
        for (const bits of bitStrings(wires)) {
          const expected = [...bits];
          expected[target] ^= expected[control];
          assert.deepEqual(execute(compiled, bits), expected, `${wires} wires, CNOT(${control}, ${target}), ${bits}`);
        }
      }
    }
  }
});

test('arbitrary permutations use output-to-input routing, and repeated structural swaps cancel', () => {
  const order = [2, 0, 3, 1];
  const source = presentation({ perm: order });
  const compiled = exportTheory(importTheory(source)).equations[0].lhs.ops;
  for (const bits of bitStrings(4)) assert.deepEqual(execute(compiled, bits), order.map(index => bits[index]));
  const twice = presentation({ perm: [1, 0], repeat: 2 });
  assert.deepEqual(importTheory(twice).rules[0].left, []);
  const repeated = presentation({ perm: [2, 0, 1], repeat: 2 });
  const repeatedOps = exportTheory(importTheory(repeated)).equations[0].lhs.ops;
  for (const bits of bitStrings(3)) assert.deepEqual(execute(repeatedOps, bits), [bits[1], bits[2], bits[0]]);
});

test('Qubit Clifford interaction routing agrees with the original ordered CNOT placements', () => {
  const interaction = exportTheory(importTheory(fixture('qubit_clifford.json'))).equations.find(rule => rule.id === 'I');
  for (const bits of bitStrings(3)) {
    const expected = [...bits];
    expected[2] ^= expected[1];
    expected[1] ^= expected[0];
    expected[2] ^= expected[0];
    assert.deepEqual(execute(interaction.lhs.ops, bits), expected);
  }
});

test('macros, tensors, composition, repeats, and scalar identities retain editable calls without dropping real gates', () => {
  const source = {
    name: 'Expansion', generators: { s: 0, H: 1 },
    macros: { HH: { gen: 'H', repeat: 2 }, body: { tensor: [{ gen: 's' }, { macro: 'HH' }, { id: 1 }] } },
    equations: [{ id: 'Expanded', lhs: { compose: [{ macro: 'body' }, { wires: 2, ops: [{ macro: 'HH', on: 1 }] }] }, rhs: { id: 2 } }],
  };
  const draft = importTheory(source);
  assert.deepEqual(draft.generators.map(generator => generator.name), ['s', 'H']);
  assert.equal(draft.rules[0].wires, 2);
  assert.deepEqual(circuitTrace(exportTheory(draft).equations[0].lhs), circuitTrace({ wires: 2, ops: [
    { gen: 's', on: [] }, { gen: 'H', on: [0] }, { gen: 'H', on: [1] },
    { gen: 'H', on: [0] }, { gen: 'H', on: [1] },
  ] }));
  assert.deepEqual(draft.shortcuts.map(shortcut => shortcut.name), ['HH', 'body']);
  assert.equal(draft.shortcuts[1].left.filter(operation => operation.generator === draft.shortcuts[0].id).length, 1);
  assert.equal(draft.rules[0].left.length, 2);
  assert.equal(Math.max(...draft.rules[0].left.map(operation => operation.column)), 1);
});

test('routing cancellation keeps the simplified affine d5 presentation inside existing editor bounds', () => {
  const draft = importTheory(fixture('affine_simplified_d5.json'));
  const rule = draft.rules.find(rule => rule.name === 'A7');
  assert.equal(rule.right.length, 15);
  assert.equal(Math.max(...rule.right.map(operation => operation.column)), 14);
  assert.equal(draft.rules.length, 7);
});

test('own saved drafts retain structure, ordered controls, sparse layouts, and settings when opened', () => {
  let draft = addGenerator({ ...createTheory(), structure: 'Polycontrolled PROP', controlValues: 3 }, { name: 'H', arity: 1 });
  draft = addRule(draft, { name: 'Saved', wires: 3 });
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 7);
  draft = controlCircuit(draft, 'r1', 'left', 1, 2);
  draft = controlCircuit(draft, 'r1', 'left', 0, 0);
  const opened = parseTheoryFile(serializeDraft(draft));
  assert.deepEqual(opened, draft);
  opened.rules[0].left[0].controls[0].value = 1;
  assert.equal(draft.rules[0].left[0].controls[0].value, 0);
  assert.equal(parseTheoryFile(JSON.stringify(fixture('qubit_clifford.json'))).rules.length, 8);
});

test('macro resolution is independent of prototype names and rejects cycles or unsupported unused bodies', () => {
  const source = JSON.parse('{"generators":{"H":1,"Z":1},"macros":{"__proto__":{"gen":"H"},"constructor":{"macro":"__proto__"}},"equations":[{"id":"Safe","lhs":{"macro":"constructor"},"rhs":{"gen":"Z"}}]}');
  assert.equal(importTheory(source).rules[0].left.length, 1);
  assert.throws(() => importTheory({ ...source, macros: { loop: { macro: 'loop' } } }), /cycle/);
  assert.throws(() => importTheory({ ...source, macros: { a: { macro: 'b' }, b: { macro: 'a' } } }), /cycle/);
  assert.throws(() => importTheory({ ...source, macros: { unused: { control: { gen: 'H' } } } }), /exactly one/);
  assert.throws(() => importTheory({ ...source, macros: { bad: { macro: 'toString' } } }), /defined macro/);
});

test('unsupported type changes, schematic patterns, ambiguous forms, and malformed placements never partially import', () => {
  const valid = presentation({ wires: 2, ops: [{ gen: 'CNOT' }] });
  const badTerms = [
    { gen: 'missing' }, { gen: 'CNOT', macro: 'alias' }, { gen: 'CNOT', repeat: 0 }, { gen: 'CNOT', repeat: '2' },
    { id: -1 }, { id: 2, repeat: 2 }, { perm: [0, 0] }, { perm: [0, 2] }, { perm: [true] },
    { compose: [] }, { compose: [{ id: 0 }, { id: 1 }] }, { tensor: [{ id: 4 }, { id: 3 }] },
    { wires: 2 }, { ops: [] }, { wires: 2, ops: [{ gen: 'CNOT', on: 0 }] },
    { wires: 2, ops: [{ gen: 'CNOT', on: [0, 0] }] }, { wires: 2, ops: [{ gen: 'CNOT', on: [0, 2] }] },
    { wires: 3, ops: [{ gen: 'CNOT' }] }, { wires: 2, ops: [{ gen: 'CNOT', on: [0, 1], extra: true }] },
    { wires: 2, ops: [{ perm: [1, 0], on: [0, 1] }] }, { wires: 2, ops: [{ perm: [0] }] },
    { wires: 2, ops: [{ gen: 'CNOT', controls: [0] }] }, { pattern: 'all arities' },
  ];
  for (const lhs of badTerms) {
    const source = structuredClone(valid);
    source.equations[0].lhs = lhs;
    const before = JSON.stringify(source);
    assert.throws(() => importTheory(source), RangeError, JSON.stringify(lhs));
    assert.equal(JSON.stringify(source), before);
  }
  for (const generators of [{ G: [1, 2] }, { G: { type: 'n' } }, { G: { type: 1, pattern: true } }, []]) {
    assert.throws(() => importTheory({ ...valid, generators }), RangeError);
  }
  for (const extra of [{ patterns: [] }, { macros: null }, { equations: 'rules' }]) assert.throws(() => importTheory({ ...valid, ...extra }), RangeError);
  assert.throws(() => importTheory({ ...valid, equations: [{ id: 'Wrong', lhs: { id: 1 }, rhs: { id: 2 } }] }), /same wire count/);
});

test('file size, nesting, repetition, macro growth, and editor caps are bounded', () => {
  for (const source of ['{', 'null', '[]', 'false', ' '.repeat(LIMITS.bytes + 1), 'λ'.repeat(LIMITS.bytes)]) assert.throws(() => parseTheoryFile(source), RangeError);
  assert.throws(() => parseTheoryFile({}), /JSON text/);
  let nested = { id: 2 };
  for (let index = 0; index < 70; index++) nested = { tensor: [nested] };
  assert.throws(() => importTheory(presentation({ wires: 2, ops: [{ gen: 'CNOT', repeat: 10_001 }] })), /repeat/);
  assert.throws(() => importTheory({ ...presentation({ id: 2 }), equations: [{ id: 'Deep', lhs: nested, rhs: { id: 2 } }] }), /depth/);
  const huge = { ...presentation({ id: 2 }), macros: { many: { gen: 'CNOT', repeat: 200 }, huge: { macro: 'many', repeat: 200 } } };
  assert.throws(() => importTheory(huge), /bounded circuit expansion/);
  assert.throws(() => importTheory({ ...presentation({ id: 2 }),
    macros: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`M${index}`, { id: 2 }])) }), /at most 128 macros/);
  const identityForest = { tensor: Array.from({ length: 10_000 }, () => ({ id: 0 })) };
  assert.throws(() => importTheory(presentation(identityForest)), /bounded circuit expansion/);
  assert.throws(() => importTheory(presentation({ wires: 2, ops: [{ gen: 'CNOT', repeat: 17 }] })), /16-column/);
  assert.throws(() => importTheory(presentation({ wires: 2, ops: [{ gen: 'CNOT', repeat: 65 }] })), /64-gate/);
});
