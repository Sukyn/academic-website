import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, STRUCTURES, availableGates, supportsControls, targetWires, touchedWires,
  createTheory, normalizeDraft, addGenerator, updateGenerator, removeGenerator,
  addRule, updateRule, removeRule, placeGate, insertGate, getCircuitColumns, removeGate, removeGates, exportTheory, serializeDraft, parseDraft,
  controlCircuit, removeControls,
} from '../src/lib/minimality/model.js';

function example() {
  let draft = addGenerator(createTheory(), { name: 'H', arity: 1 });
  draft = addGenerator(draft, { name: 'C', arity: 2 });
  return addRule(draft, { name: 'Involution', wires: 3 });
}

test('categorical structures have exact labels and legacy drafts default to PRO without mutation', () => {
  assert.deepEqual(STRUCTURES, ['PRO', 'PROP', 'Braided', 'Controlled PROP', 'Polycontrolled PROP']);
  assert.equal(Object.isFrozen(STRUCTURES), true);
  assert.equal(createTheory().structure, 'PRO');
  const legacy = example();
  delete legacy.structure;
  const source = JSON.stringify(legacy);
  assert.equal(normalizeDraft(legacy).structure, 'PRO');
  assert.equal(parseDraft(source).structure, 'PRO');
  assert.deepEqual(exportTheory(legacy), exportTheory({ ...legacy, structure: 'PRO' }));
  assert.equal(JSON.stringify(legacy), source);
});

test('every structure survives edits, gate moves, and editable save/open round trips', () => {
  for (const structure of STRUCTURES) {
    let draft = { ...example(), structure };
    draft = updateGenerator(draft, 'g1', { name: 'H1' });
    draft = placeGate(draft, 'r1', 'left', 'g1', 0, 3);
    const source = { ruleId: 'r1', side: 'left', id: draft.rules[0].left[0].id };
    draft = insertGate(draft, 'r1', 'right', 'g1', 0, 0, source);
    assert.equal(draft.structure, structure);
    assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  }
});

test('explicit invalid structures are rejected and search guards unsupported categorical structures', () => {
  for (const structure of [undefined, null, '', 'pro', 'PRO ', 'Unknown', 0, {}, []]) {
    assert.throws(() => normalizeDraft({ ...example(), structure }), /categorical structure/);
    if (structure !== undefined) {
      assert.throws(() => parseDraft(JSON.stringify({ ...example(), structure })), /categorical structure/);
    }
  }
  for (const structure of ['Braided', 'Controlled PROP', 'Polycontrolled PROP']) {
    assert.throws(() => exportTheory({ ...example(), structure }), /supports PRO and PROP theories only/);
  }
});

test('control value counts default for old drafts, round trip, and reject explicit invalid values', () => {
  const legacy = example();
  delete legacy.controlValues;
  const before = JSON.stringify(legacy);
  assert.equal(createTheory().controlValues, 2);
  assert.equal(normalizeDraft(legacy).controlValues, 2);
  assert.equal(JSON.stringify(legacy), before);
  for (const controlValues of [2, 3, 4, 5, 6]) {
    const draft = normalizeDraft({ ...legacy, controlValues });
    assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  }
  for (const controlValues of [undefined, null, 1, 7, 2.5, '2', NaN]) {
    assert.throws(() => normalizeDraft({ ...legacy, controlValues }), /number of control values/);
  }
});

test('available structural gates follow the category and cannot collide with generator ids', () => {
  for (const structure of STRUCTURES) {
    const draft = { ...example(), structure };
    const gates = availableGates(draft);
    assert.deepEqual(gates.slice(0, 2), draft.generators);
    assert.equal(gates[0].kind, undefined);
    assert.equal(supportsControls(structure), structure === 'Controlled PROP' || structure === 'Polycontrolled PROP');
    const expected = structure === 'PRO' ? [] : structure === 'Braided'
      ? [ ['$braid', 'Braid', 'braid'], ['$braid-inverse', 'Braid inverse', 'braid-inverse'] ]
      : [ ['$swap', 'Swap', 'swap'] ];
    assert.deepEqual(gates.slice(2).map(({ id, name, arity, kind }) => [id, name, kind, arity]),
      expected.map(entry => [...entry, 2]));
  }
  const invalid = example();
  invalid.generators[0].id = '$swap';
  assert.throws(() => normalizeDraft(invalid), /identifier/);
});

test('PROP swaps export full-register permutations, including theories without generators', () => {
  let draft = addRule({ ...createTheory(), structure: 'PROP' }, { name: 'Symmetry', wires: 4 });
  draft = placeGate(draft, 'r1', 'left', '$swap', 1, 2);
  draft = insertGate(draft, 'r1', 'left', '$swap', 0, 1);
  assert.deepEqual(exportTheory(draft), {
    structure: 'PROP', name: 'Untitled theory', generators: {},
    equations: [{ id: 'Symmetry', lhs: { wires: 4, ops: [
      { perm: [0, 2, 1, 3] }, { perm: [1, 0, 2, 3] },
    ] }, rhs: { wires: 4, ops: [] } }],
  });
  assert.throws(() => placeGate(draft, 'r1', 'right', '$swap', 3, 0), /does not fit/);
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  const before = serializeDraft(draft);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'PRO' }), /does not support that crossing/);
  assert.equal(serializeDraft(draft), before);
});

test('braids retain crossing direction in saved diagrams and cannot become PROP swaps implicitly', () => {
  let draft = { ...example(), structure: 'Braided' };
  draft = placeGate(draft, 'r1', 'left', '$braid', 0, 0);
  draft = placeGate(draft, 'r1', 'right', '$braid-inverse', 0, 0);
  assert.equal(parseDraft(serializeDraft(draft)).rules[0].right[0].generator, '$braid-inverse');
  const before = serializeDraft(draft);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'PROP' }), /does not support that crossing/);
  assert.throws(() => placeGate(draft, 'r1', 'left', '$swap', 0, 1), /does not support that crossing/);
  assert.throws(() => exportTheory(draft), /supports PRO and PROP/);
  assert.equal(serializeDraft(draft), before);
});

test('empty drafts can be saved while Run requires generators and equations', () => {
  const draft = createTheory();
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  assert.throws(() => exportTheory(draft), /Add at least one generator/);
  assert.throws(() => exportTheory(addGenerator(draft, { name: 'H', arity: 1 })), /Add at least one equation/);
  assert.doesNotThrow(() => exportTheory(example()));
});

test('compact saves omit default settings and trailing identities while retaining arbitrary IDs and sparse columns', () => {
  const draft = normalizeDraft({
    version: 1, name: 'Small save', generators: [{ id: 'custom_gate', name: 'H', arity: 1 }], rules: [
      { id: 'identity', name: 'Identity', wires: 0, left: [], right: [] },
      { id: 'left_only', name: 'Left', wires: 1, left: [{ id: 'arbitrary_42', generator: 'custom_gate', wire: 0, column: 15 }], right: [] },
      { id: 'right_only', name: 'Right', wires: 1, left: [], right: [{ id: 'other_id', generator: 'custom_gate', wire: 0, column: 7 }] },
    ],
  });
  const packed = JSON.parse(serializeDraft(draft));
  assert.deepEqual(packed, {
    version: 2, name: 'Small save', generators: [['custom_gate', 'H', 1]], rules: [
      ['identity', 'Identity', 0],
      ['left_only', 'Left', 1, [['arbitrary_42', 'custom_gate', 0, 15]]],
      ['right_only', 'Right', 1, [], [['other_id', 'custom_gate', 0, 7]]],
    ],
  });
  assert.deepEqual(normalizeDraft(packed), draft);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft, 'Existing version 1 files remain readable');
  assert.deepEqual(parseDraft(serializeDraft(packed)), draft);
  const decoded = normalizeDraft(packed);
  decoded.rules[1].left[0].column = 0;
  assert.equal(packed.rules[1][3][0][3], 15, 'Decoding detaches tuples from editor objects');
});

test('compact saves preserve every categorical structure, scalar anchors, and ordered nested controls', () => {
  for (const structure of STRUCTURES) {
    const controls = supportsControls(structure) ? [{ wire: 1, value: 1 }, { wire: 0, value: structure === 'Polycontrolled PROP' ? 2 : 1 }] : [];
    const draft = normalizeDraft({
      ...createTheory(), name: 'Controlled λ', structure, controlValues: 3,
      generators: [{ id: 'custom_H', name: 'H', arity: 1 }, { id: 'scalar_phase', name: 'ω', arity: 0 }],
      rules: [{ id: 'custom_equation', name: 'Ordered controls', wires: 4,
        left: [{ id: 'sparse_gate', generator: 'custom_H', wire: 3, column: 15, ...(controls.length ? { controls } : {}) }],
        right: [{ id: 'scalar_anchor', generator: 'scalar_phase', wire: 0, column: 9, ...(controls.length ? { controls } : {}) }],
      }],
    });
    const source = serializeDraft(draft), packed = JSON.parse(source), copy = parseDraft(source);
    assert.deepEqual(copy, draft);
    assert.equal(packed.controlValues, 3);
    assert.equal(packed.structure, structure === 'PRO' ? undefined : structure);
    if (controls.length) {
      assert.deepEqual(packed.rules[0][3][0][4], controls.map(control => [control.wire, control.value]));
      copy.rules[0].left[0].controls[0].wire = 2;
      assert.equal(draft.rules[0].left[0].controls[0].wire, 1);
    }
  }
});

test('compact saves reject malformed tuples, explicit invalid defaults, and unknown fields', () => {
  const base = {
    version: 2, name: 'Tuples', structure: 'Controlled PROP', generators: [['gate', 'H', 1]],
    rules: [['equation', 'Rule', 2, [['operation', 'gate', 1, 7, [[0, 1]]]]]],
  };
  const invalid = change => { const value = structuredClone(base); change(value); return value; };
  const values = [
    invalid(value => { value.version = 3; }),
    invalid(value => { value.extra = true; }),
    ...[null, 'PRO ', {}].map(structure => ({ ...base, structure })),
    ...[null, 1, '2'].map(controlValues => ({ ...base, controlValues })),
    ...[null, {}, [null], [['gate', 'H']], [['gate', 'H', 1, 'extra']]].map(generators => ({ ...base, generators })),
    ...[null, {}, [null], [['equation', 'Rule']], [['equation', 'Rule', 2, [], [], []]]].map(rules => ({ ...base, rules })),
  ];
  for (const side of [null, undefined, {}, [null], [{ id: 'operation', generator: 'gate', wire: 1, column: 7 }],
    [['operation', 'gate', 1]], [['operation', 'gate', 1, 7, [], 'extra']]]) {
    values.push(invalid(value => { value.rules[0][3] = side; }));
    values.push(invalid(value => { value.rules[0][4] = side; }));
  }
  for (const controls of [null, undefined, {}, [null], [[0]], [[0, 1, 2]], [{ wire: 0, value: 1 }], [[0, null]], [[0, 1], [0, 1]]]) {
    values.push(invalid(value => { value.rules[0][3][0][4] = controls; }));
  }
  for (const value of values) {
    assert.throws(() => normalizeDraft(value), RangeError);
    assert.throws(() => parseDraft(JSON.stringify(value)), RangeError);
  }
  for (const field of ['structure', 'controlValues']) {
    assert.throws(() => normalizeDraft({ ...base, [field]: undefined }), RangeError);
  }
});

test('compact saves enforce existing collection bounds before expansion and the 256 KB output cap', () => {
  const base = { version: 2, name: 'Bounds', generators: [], rules: [] };
  for (const [field, entries, pattern] of [
    ['generators', Array(LIMITS.generators + 1), /at most 12/],
    ['rules', Array(LIMITS.rules + 1), /at most 24/],
    ['rules', [['rule', 'Rule', 1, Array(LIMITS.gates + 1)]], /at most 64/],
    ['rules', [['rule', 'Rule', 1, [['gate', 'absent', 0, 0, Array(LIMITS.wires + 1)]]]], /at most 6/],
  ]) assert.throws(() => normalizeDraft({ ...base, [field]: entries }), pattern);

  const generatorId = 'g'.repeat(64);
  let index = 0;
  const draft = {
    ...createTheory(), generators: [{ id: generatorId, name: 'H', arity: 1 }],
    rules: Array.from({ length: LIMITS.rules }, (_, rule) => ({
      id: `rule${rule}`, name: `Rule ${rule}`, wires: 4,
      ...Object.fromEntries(['left', 'right'].map(side => [side, Array.from({ length: LIMITS.gates }, (_, gate) => ({
        id: `o${index++}`.padEnd(64, 'x'), generator: generatorId, wire: gate % 4, column: Math.floor(gate / 4),
      }))])),
    })),
  };
  assert.doesNotThrow(() => normalizeDraft(draft));
  assert.throws(() => serializeDraft(draft), /256 KB/);
});

test('multiwire gates occupy contiguous wires and reject overlap on every occupied wire', () => {
  const draft = placeGate(example(), 'r1', 'left', 'g2', 1, 0);
  assert.deepEqual(exportTheory(draft).equations[0].lhs.ops, [{ gen: 'C', on: [1, 2] }]);
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', 2, 0), /overlap/);
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g2', 2, 1), /does not fit/);
  assert.doesNotThrow(() => placeGate(draft, 'r1', 'left', 'g1', 0, 0));
  assert.doesNotThrow(() => placeGate(draft, 'r1', 'right', 'g1', 2, 0));
});

test('moving a gate preserves its id, ignores its former cells and never mutates input', () => {
  const draft = placeGate(example(), 'r1', 'left', 'g2', 0, 0);
  const before = structuredClone(draft), operationId = draft.rules[0].left[0].id;
  const moved = placeGate(draft, 'r1', 'left', 'g2', 1, 0, { ruleId: 'r1', side: 'left', id: operationId });
  assert.deepEqual(moved.rules[0].left, [{ id: operationId, generator: 'g2', wire: 1, column: 0 }]);
  assert.deepEqual(draft, before);
  assert.throws(() => placeGate(draft, 'r1', 'right', 'g2', 0, 0,
    { ruleId: 'r1', side: 'right', id: operationId }), /gate on this side/);
  assert.deepEqual(removeGate(moved, 'r1', 'left', operationId).rules[0].left, []);
});

test('a failed move leaves both the original gate and destination untouched', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 0);
  draft = placeGate(draft, 'r1', 'left', 'g2', 1, 1);
  const before = structuredClone(draft);
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', 2, 1,
    { ruleId: 'r1', side: 'left', id: draft.rules[0].left[0].id }), /overlap/);
  assert.deepEqual(draft, before);
});

test('placing or inserting unknown generators rejects new gates and transfers atomically', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 2);
  draft = placeGate(draft, 'r1', 'left', 'g2', 1, 5);
  const before = serializeDraft(draft);
  const source = { ruleId: 'r1', side: 'left', id: draft.rules[0].left[0].id };
  for (const action of [placeGate, insertGate]) {
    for (const from of [undefined, source]) {
      assert.throws(() => action(draft, 'r1', 'right', 'missing', 0, 0, from), /generator/);
      assert.equal(serializeDraft(draft), before);
    }
  }
});

test('cell moves within a side preserve sparse columns and stored operation order', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 2);
  draft = placeGate(draft, 'r1', 'left', 'g2', 1, 5);
  const [first, second] = draft.rules[0].left;
  const moved = placeGate(draft, 'r1', 'left', 'g1', 0, 9, { ruleId: 'r1', side: 'left', id: first.id });
  assert.deepEqual(moved.rules[0].left.map(({ id, column }) => [id, column]), [[first.id, 9], [second.id, 5]]);
  assert.deepEqual(draft.rules[0].left.map(operation => operation.column), [2, 5]);
});

test('cross-side cell moves preserve IDs and compact only the source, with atomic collision failure', () => {
  for (const targetRule of ['r1', 'r2']) {
    let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 2);
    draft = placeGate(draft, 'r1', 'left', 'g2', 1, 5);
    draft = addRule(draft, { name: 'Another equation', wires: 3 });
    draft = placeGate(draft, targetRule, 'right', 'g2', 0, 7);
    const source = { ruleId: 'r1', side: 'left', id: draft.rules[0].left[0].id };
    const before = serializeDraft(draft);
    const moved = placeGate(draft, targetRule, 'right', 'g1', 2, 7, source);
    assert.deepEqual(moved.rules[0].left.map(operation => operation.column), [0]);
    assert.deepEqual(moved.rules.find(rule => rule.id === targetRule).right.map(({ id, column }) => [id, column]),
      [[draft.rules.find(rule => rule.id === targetRule).right[0].id, 7], [source.id, 7]]);
    assert.throws(() => placeGate(draft, targetRule, 'right', 'g1', 1, 7, source), /overlap/);
    assert.equal(serializeDraft(draft), before);
  }
});

test('generator edits preserve gate references and reject invalidating arity changes or removal', () => {
  const draft = placeGate(example(), 'r1', 'left', 'g2', 1, 0);
  const renamed = updateGenerator(draft, 'g2', { name: 'Pair' });
  assert.deepEqual(exportTheory(renamed).equations[0].lhs.ops[0], { gen: 'Pair', on: [1, 2] });
  assert.throws(() => updateGenerator(draft, 'g2', { arity: 3 }), /does not fit/);
  assert.throws(() => removeGenerator(draft, 'g2'), /gates from the equations first/);
  assert.equal(removeGenerator(draft, 'g1').generators.length, 1);
  assert.equal(draft.generators[1].name, 'C');
});

test('wire-count edits reject gates that would be cut off and allow empty scalar equations', () => {
  const draft = placeGate(example(), 'r1', 'right', 'g2', 1, 0);
  assert.throws(() => updateRule(draft, 'r1', { wires: 2 }), /does not fit/);
  assert.equal(updateRule(draft, 'r1', { name: 'Renamed', wires: 4 }).rules[0].wires, 4);
  assert.equal(updateRule(example(), 'r1', { wires: 0 }).rules[0].wires, 0);
  assert.equal(removeRule(draft, 'r1').rules.length, 0);
});

test('names are normalized and must be nonempty and unique within each kind', () => {
  const draft = example();
  assert.equal(updateGenerator(draft, 'g1', { name: ' H1 ' }).generators[0].name, 'H1');
  assert.throws(() => addGenerator(draft, { name: ' H ', arity: 1 }), /unique/);
  assert.throws(() => updateGenerator(draft, 'g2', { name: 'H' }), /unique/);
  assert.throws(() => addRule(draft, { name: ' Involution ', wires: 1 }), /unique/);
  for (const value of ['', '  ', 'line\nbreak', 'x'.repeat(LIMITS.generatorName + 1)]) {
    assert.throws(() => addGenerator(draft, { name: value, arity: 1 }), RangeError);
  }
  assert.doesNotThrow(() => addGenerator(draft, { name: 'λ', arity: 1 }));
});

test('generator names must fit four supported display symbols on creation, editing, and opening', () => {
  for (const raw of ['CNOT', 'X_1', 'A+B', 'omega_dagger', '\\omega', 'S_inv', 'S_prime', 'varepsilon_varepsilon', 'minus_one']) {
    const draft = addGenerator(createTheory(), { name: raw, arity: 1 });
    assert.equal(draft.generators[0].name, raw, 'Primitive identifiers retain their exact spelling');
    assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  }
  const draft = example(), before = structuredClone(draft);
  for (const raw of ['ABCDE', 'CNOT_dagger', 'H H', '<H>', '🙂', 'é', '中', '\\x', '\\unknown', 'H^2', 'H_{1}',
    'a,b', 'H/2', 'H*H', 'H\u200b', 'H\u200d', 'H\u202e', 'α\u0301']) {
    assert.throws(() => addGenerator(draft, { name: raw, arity: 1 }), /must render as 1–4/);
    assert.throws(() => updateGenerator(draft, 'g1', { name: raw }), /must render as 1–4/);
    const invalid = structuredClone(draft);
    invalid.generators[0].name = raw;
    assert.throws(() => parseDraft(JSON.stringify(invalid)), /must render as 1–4/);
    const packed = JSON.parse(serializeDraft(draft));
    packed.generators[0][1] = raw;
    assert.throws(() => parseDraft(JSON.stringify(packed)), /must render as 1–4/);
    assert.deepEqual(draft, before);
  }
  const longCommand = '\\varepsilon'.repeat(3);
  assert.throws(() => addGenerator(draft, { name: longCommand, arity: 1 }), /1–32/);
  assert.doesNotThrow(() => updateRule({ ...draft, name: 'A descriptive theory name' }, 'r1', { name: 'A descriptive equation name' }));
});

test('generators cannot share a rendered name and search preserves exact primitive names', () => {
  for (const [first, second] of [['omega', 'ω'], ['\\omega', 'omega'], ['S_dagger', 'S†'], ['S_prime', 'S′'],
    ['S_inv', 'S⁻¹'], ['minus_one', '−1']]) {
    const draft = addGenerator(createTheory(), { name: first, arity: 1 });
    assert.throws(() => addGenerator(draft, { name: second, arity: 1 }), /unique/);
  }
  let draft = addGenerator(createTheory(), { name: 'minus_one', arity: 0 });
  draft = addGenerator(draft, { name: 'omega', arity: 0 });
  draft = addRule(draft, { name: 'Scalar labels', wires: 0 });
  draft = placeGate(draft, 'r1', 'left', 'g1', 0, 0);
  draft = placeGate(draft, 'r1', 'right', 'g2', 0, 0);
  const exported = exportTheory(draft);
  assert.deepEqual(Object.keys(exported.generators), ['minus_one', 'omega']);
  assert.deepEqual(exported.equations[0].lhs.ops, [{ gen: 'minus_one', on: [] }]);
  assert.deepEqual(exported.equations[0].rhs.ops, [{ gen: 'omega', on: [] }]);
});

test('canonical export drops editor ids and layout, keeps execution order and exact wire slices', () => {
  let draft = example();
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 3);
  draft = placeGate(draft, 'r1', 'left', 'g2', 0, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 0);
  const before = structuredClone(draft);
  assert.deepEqual(exportTheory(draft), {
    name: 'Untitled theory', generators: { H: { type: 1 }, C: { type: 2 } },
    equations: [{ id: 'Involution', lhs: { wires: 3, ops: [
      { gen: 'C', on: [0, 1] }, { gen: 'H', on: [2] }, { gen: 'H', on: [2] },
    ] }, rhs: { wires: 3, ops: [] } }],
  });
  assert.deepEqual(draft, before);
});

test('scalar generators export no wires and have a single unambiguous grid anchor', () => {
  let draft = addGenerator(createTheory(), { name: 's', arity: 0 });
  draft = addRule(draft, { name: 'Scalar identity', wires: 0 });
  draft = placeGate(draft, 'r1', 'left', 'g1', 0, 0);
  assert.deepEqual(exportTheory(draft).equations[0].lhs, { wires: 0, ops: [{ gen: 's', on: [] }] });
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', 1, 1), /wire 0/);
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', 0, 0), /one scalar/);
  assert.doesNotThrow(() => placeGate(draft, 'r1', 'left', 'g1', 0, 1));
});

test('saved drafts reject dangling references, duplicate ids, overlaps and unsupported constructs', () => {
  const draft = placeGate(example(), 'r1', 'left', 'g1', 0, 0);
  const invalid = change => { const value = structuredClone(draft); change(value); return value; };
  for (const value of [
    invalid(value => { value.version = 3; }),
    invalid(value => { value.generators[0].id = value.generators[1].id; }),
    invalid(value => { value.rules[0].left[0].id = 'g1'; }),
    invalid(value => { value.rules[0].left[0].generator = 'missing'; }),
    invalid(value => { value.rules[0].left.push({ ...value.rules[0].left[0], id: 'o2' }); }),
    invalid(value => { value.rules[0].left[0].controls = [1]; }),
    invalid(value => { value.rules[0].left[0].on = [0, 2]; }),
    invalid(value => { value.rules[0].semantics = {}; }),
  ]) {
    assert.throws(() => normalizeDraft(value), RangeError);
    assert.throws(() => exportTheory(value), RangeError);
    assert.throws(() => parseDraft(JSON.stringify(value)), RangeError);
  }
});

test('ids remain unique after deletions and are detached across round trips', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 0);
  draft = placeGate(draft, 'r1', 'right', 'g1', 0, 0);
  assert.notEqual(draft.rules[0].left[0].id, draft.rules[0].right[0].id);
  draft = removeGenerator(draft, 'g2');
  draft = addGenerator(draft, { name: 'Z', arity: 1 });
  assert.equal(new Set(draft.generators.map(value => value.id)).size, 2);
  const copy = parseDraft(serializeDraft(draft));
  copy.rules[0].left[0].wire = 2;
  assert.equal(draft.rules[0].left[0].wire, 0);
});

test('placement and import enforce finite resource and numeric bounds', () => {
  const draft = example();
  for (const [wire, column] of [[-1, 0], [.5, 0], [0, -1], [0, 16], [0, Infinity], [0, '1']]) {
    assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', wire, column), RangeError);
  }
  for (const arity of [-1, .5, 7, '1', NaN]) assert.throws(() => addGenerator(draft, { name: 'Bad', arity }), RangeError);
  assert.throws(() => updateRule(draft, 'r1', { wires: 7 }), RangeError);
  const tooManyGenerators = { ...draft, generators: Array.from({ length: 13 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, arity: 1 })) };
  assert.throws(() => normalizeDraft(tooManyGenerators), /at most 12/);
  const tooManyRules = { ...draft, rules: Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, wires: 1, left: [], right: [] })) };
  assert.throws(() => normalizeDraft(tooManyRules), /at most 24/);
  const tooManyGates = structuredClone(draft);
  tooManyGates.rules[0].left = Array.from({ length: 65 }, (_, i) => ({ id: `o${i}`, generator: 'g1', wire: 0, column: 0 }));
  assert.throws(() => normalizeDraft(tooManyGates), /at most 64/);
});

test('persistence rejects malformed and oversized JSON before treating it as a draft', () => {
  for (const source of ['{', 'null', '[]', 'false', '"text"', ' '.repeat(LIMITS.bytes + 1), 'λ'.repeat(LIMITS.bytes)]) {
    assert.throws(() => parseDraft(source), RangeError);
  }
  assert.throws(() => parseDraft({}), /JSON text/);
  assert.throws(() => updateRule(example(), 'absent', { name: 'New' }), /existing equation/);
  assert.throws(() => placeGate(example(), 'r1', 'lhs', 'g1', 0, 0), /left or right/);
});

test('visible columns omit old gaps without changing imported or saved layouts', () => {
  const draft = placeGate(example(), 'r1', 'left', 'g1', 0, 4);
  const before = serializeDraft(draft);
  assert.deepEqual(getCircuitColumns([]), []);
  assert.deepEqual(getCircuitColumns(draft.rules[0].left), [4]);
  assert.equal(serializeDraft(parseDraft(before)), before);
});

test('inserting before, between, and after gates grows dense columns and keeps parallel layers', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 4);
  const before = structuredClone(draft);
  const between = insertGate(draft, 'r1', 'left', 'g2', 0, 1);
  assert.deepEqual(between.rules[0].left.map(({ wire, column }) => [wire, column]), [[0, 0], [2, 0], [2, 2], [0, 1]]);
  assert.deepEqual(draft, before);
  const first = insertGate(between, 'r1', 'left', 'g1', 0, 0);
  assert.deepEqual(getCircuitColumns(first.rules[0].left), [0, 1, 2, 3]);
  const last = insertGate(first, 'r1', 'left', 'g1', 0, 4);
  assert.equal(last.rules[0].left.at(-1).column, 4);
  assert.deepEqual(exportTheory(between).equations[0].lhs.ops, [
    { gen: 'H', on: [0] }, { gen: 'H', on: [2] }, { gen: 'C', on: [0, 1] }, { gen: 'H', on: [2] },
  ]);
});

test('moving to a gap accounts for removed columns and preserves gate identity', () => {
  let draft = example();
  for (let column = 0; column < 3; column++) draft = placeGate(draft, 'r1', 'left', 'g1', 0, column);
  const [first, second, third] = draft.rules[0].left;
  const moved = insertGate(draft, 'r1', 'left', 'g1', 0, 3, { ruleId: 'r1', side: 'left', id: first.id });
  assert.deepEqual([...moved.rules[0].left].sort((a, b) => a.column - b.column).map(operation => operation.id),
    [second.id, third.id, first.id]);
  assert.deepEqual(getCircuitColumns(moved.rules[0].left), [0, 1, 2]);
  const same = insertGate(draft, 'r1', 'left', 'g1', 0, 1, { ruleId: 'r1', side: 'left', id: first.id });
  assert.deepEqual(exportTheory(same), exportTheory(draft));
  const parallel = placeGate(draft, 'r1', 'left', 'g1', 1, 0);
  const separated = insertGate(parallel, 'r1', 'left', 'g1', 0, 1, { ruleId: 'r1', side: 'left', id: first.id });
  assert.equal(separated.rules[0].left.find(operation => operation.id === first.id).column, 1);
  assert.deepEqual(getCircuitColumns(separated.rules[0].left), [0, 1, 2, 3]);
});

test('gap moves in sparse imported layouts preserve order around both sides of the source', () => {
  let draft = example();
  for (const column of [2, 6, 11]) draft = placeGate(draft, 'r1', 'left', 'g1', 0, column);
  const [first, middle, last] = draft.rules[0].left.map(operation => operation.id);
  const before = serializeDraft(draft);
  for (const [id, boundary, expected] of [
    [middle, 1, [first, middle, last]],
    [middle, 2, [first, middle, last]],
    [first, 3, [middle, last, first]],
    [last, 0, [last, first, middle]],
  ]) {
    const moved = insertGate(draft, 'r1', 'left', 'g1', 0, boundary, { ruleId: 'r1', side: 'left', id });
    assert.deepEqual([...moved.rules[0].left].sort((a, b) => a.column - b.column).map(operation => operation.id), expected);
    assert.deepEqual(getCircuitColumns(moved.rules[0].left), [0, 1, 2]);
  }
  assert.equal(serializeDraft(draft), before, 'Every move preserves the original history entry');
});

test('moving between equations compacts both affected sides atomically', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 1);
  draft = placeGate(draft, 'r1', 'left', 'g2', 1, 5);
  draft = addRule(draft, { name: 'Destination', wires: 3 });
  draft = placeGate(draft, 'r2', 'right', 'g1', 0, 3);
  const before = structuredClone(draft), source = { ruleId: 'r1', side: 'left', id: draft.rules[0].left[1].id };
  const moved = insertGate(draft, 'r2', 'right', 'g2', 1, 0, source);
  assert.deepEqual(moved.rules[0].left.map(operation => operation.column), [0]);
  assert.deepEqual([...moved.rules[1].right].sort((a, b) => a.column - b.column).map(({ id, column }) => [id, column]),
    [[source.id, 0], [draft.rules[1].right[0].id, 1]]);
  assert.deepEqual(draft, before);
  assert.throws(() => insertGate(draft, 'r2', 'right', 'g2', 2, 0, source), /does not fit/);
  assert.deepEqual(draft, before);
});

test('removal compacts empty columns while preserving parallel columns and other sides', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 1);
  draft = placeGate(draft, 'r1', 'left', 'g1', 1, 1);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 5);
  draft = placeGate(draft, 'r1', 'right', 'g1', 0, 4);
  const removed = removeGate(draft, 'r1', 'left', draft.rules[0].left[0].id);
  assert.deepEqual(removed.rules[0].left.map(operation => operation.column), [0, 1]);
  assert.equal(removed.rules[0].right[0].column, 4);
  const lastInColumn = removeGate(removed, 'r1', 'left', removed.rules[0].left[0].id);
  assert.deepEqual(lastInColumn.rules[0].left.map(operation => operation.column), [0]);
});

test('batch deletion preserves surviving parallel gates, scalar anchors, controls, and the opposite side', () => {
  let draft = addGenerator(controlledExample('Polycontrolled PROP'), { name: 'ph', arity: 0 });
  for (const [generator, wire, column] of [
    ['g1', 1, 2], ['g1', 2, 2], ['g3', 0, 2], ['g1', 3, 5], ['g3', 0, 5], ['g1', 1, 9],
  ]) draft = placeGate(draft, 'r1', 'left', generator, wire, column);
  const [first, parallel, scalar, later, laterScalar, last] = draft.rules[0].left;
  draft = controlCircuit(draft, 'r1', 'left', 0, 0, [first.id, parallel.id, scalar.id]);
  draft = placeGate(draft, 'r1', 'right', 'g1', 2, 4);
  const before = structuredClone(draft), selected = [last.id, scalar.id, first.id];
  const removed = removeGates(draft, 'r1', 'left', selected);
  assert.deepEqual(removed, selected.reduce((value, id) => removeGate(value, 'r1', 'left', id), draft));
  assert.deepEqual(removed.rules[0].left.map(({ id, wire, column, controls }) => ({ id, wire, column, controls })), [
    { id: parallel.id, wire: 2, column: 0, controls: [{ wire: 0, value: 0 }] },
    { id: later.id, wire: 3, column: 1, controls: undefined },
    { id: laterScalar.id, wire: 0, column: 1, controls: undefined },
  ]);
  assert.deepEqual(removed.rules[0].right, draft.rules[0].right);
  assert.deepEqual(draft, before);
  assert.deepEqual(removeGates(draft, 'r1', 'left').rules[0], { ...draft.rules[0], left: [] });
  assert.deepEqual(removeGates(draft, 'r1', 'right').rules[0], { ...draft.rules[0], right: [] });
});

test('batch deletion rejects invalid selections atomically, including a late missing gate', () => {
  let draft = placeGate(example(), 'r1', 'left', 'g1', 0, 2);
  draft = placeGate(draft, 'r1', 'left', 'g1', 1, 7);
  const [first, second] = draft.rules[0].left.map(operation => operation.id), before = structuredClone(draft);
  for (const selection of [[], [first, second, 'missing'], [first, first], null, {}, 'all', Array(LIMITS.gates + 1).fill(first)]) {
    assert.throws(() => removeGates(draft, 'r1', 'left', selection), RangeError);
    assert.deepEqual(draft, before);
  }
  assert.throws(() => removeGates(draft, 'r1', 'right', [first]), /gate on this side/);
  assert.throws(() => removeGates(draft, 'r1', 'right'), /Choose at least one/);
  assert.throws(() => removeGates(draft, 'missing', 'left', [first]), /existing equation/);
  assert.throws(() => removeGates(draft, 'r1', 'middle', [first]), /left or right/);
  assert.deepEqual(draft, before);
});

test('insertion supports empty scalar circuits and enforces column and gate caps atomically', () => {
  let scalar = addGenerator(createTheory(), { name: 's', arity: 0 });
  scalar = addRule(scalar, { name: 'Scalar', wires: 0 });
  scalar = insertGate(scalar, 'r1', 'left', 'g1', 0, 0);
  scalar = insertGate(scalar, 'r1', 'left', 'g1', 0, 0);
  assert.deepEqual(getCircuitColumns(scalar.rules[0].left), [0, 1]);
  assert.deepEqual(exportTheory(scalar).equations[0].lhs.ops, [{ gen: 's', on: [] }, { gen: 's', on: [] }]);

  const fullColumns = example();
  fullColumns.rules[0].left = Array.from({ length: LIMITS.columns }, (_, column) =>
    ({ id: `o${column}`, generator: 'g1', wire: 0, column }));
  const before = structuredClone(fullColumns);
  assert.throws(() => insertGate(fullColumns, 'r1', 'left', 'g1', 0, 1), /at most 16 columns/);
  assert.deepEqual(fullColumns, before);
  assert.doesNotThrow(() => insertGate(fullColumns, 'r1', 'left', 'g1', 0, 16,
    { ruleId: 'r1', side: 'left', id: 'o0' }));

  const fullGates = updateRule(example(), 'r1', { wires: 6 });
  fullGates.rules[0].left = Array.from({ length: LIMITS.gates }, (_, index) =>
    ({ id: `o${index}`, generator: 'g1', wire: index % 6, column: Math.floor(index / 6) }));
  assert.throws(() => insertGate(fullGates, 'r1', 'left', 'g1', 0, 0), /at most 64/);
  assert.equal(fullGates.rules[0].left.length, 64);
  for (const boundary of [-1, .5, 12, Infinity]) {
    assert.throws(() => insertGate(example(), 'r1', 'left', 'g1', 0, boundary), /insertion position/);
  }
});

function controlledExample(structure = 'Controlled PROP', wires = 4) {
  return updateRule({ ...example(), structure }, 'r1', { wires });
}

test('nested controls preserve outer-to-inner order and polycontrol values across persistence', () => {
  let draft = { ...controlledExample('Polycontrolled PROP'), controlValues: 3 };
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 4);
  draft = controlCircuit(draft, 'r1', 'left', 1, 2);
  const before = serializeDraft(draft);
  const nested = controlCircuit(draft, 'r1', 'left', 0, 0);
  const operation = nested.rules[0].left[0];
  assert.deepEqual(operation.controls, [{ wire: 0, value: 0 }, { wire: 1, value: 2 }]);
  const gates = new Map(availableGates(nested).map(gate => [gate.id, gate]));
  assert.deepEqual(targetWires(operation, gates), [2]);
  assert.deepEqual(touchedWires(operation, gates), [2, 0, 1]);
  assert.deepEqual(parseDraft(serializeDraft(nested)), nested);
  assert.equal(serializeDraft(draft), before);
  assert.throws(() => normalizeDraft({ ...nested, structure: 'Controlled PROP' }), /control value/);
  assert.throws(() => normalizeDraft({ ...nested, controlValues: 2 }), /control value/);
  assert.throws(() => normalizeDraft({ ...nested, structure: 'PROP' }), /does not support controls/);
  const cleared = removeControls(nested, 'r1', 'left');
  assert.equal(Object.hasOwn(cleared.rules[0].left[0], 'controls'), false);
  assert.doesNotThrow(() => exportTheory({ ...cleared, structure: 'PROP' }));
});

test('control validation rejects malformed, repeated, target, and out-of-register controls', () => {
  const draft = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  const withControls = controls => {
    const result = structuredClone(draft);
    result.rules[0].left[0].controls = controls;
    return result;
  };
  for (const controls of [
    null, {}, [1], [{ wire: 0, value: 0 }], [{ wire: 0, value: 2 }],
    [{ wire: 0, value: 1, extra: true }], [{ wire: 0 }],
    [{ wire: 1, value: 1 }], [{ wire: 4, value: 1 }],
    [{ wire: 0, value: 1 }, { wire: 0, value: 1 }],
  ]) assert.throws(() => normalizeDraft(withControls(controls)), RangeError);
  const empty = normalizeDraft(withControls([]));
  assert.equal(Object.hasOwn(empty.rules[0].left[0], 'controls'), false);
  assert.throws(() => normalizeDraft({ ...withControls([{ wire: 0, value: 1 }]), structure: 'PRO' }), /does not support controls/);
  const poly = { ...draft, structure: 'Polycontrolled PROP', controlValues: 3 };
  for (const value of [-1, 3, 1.5, '1', undefined]) {
    const invalid = structuredClone(poly);
    invalid.rules[0].left[0].controls = [{ wire: 0, value }];
    assert.throws(() => normalizeDraft(invalid), /control value/);
  }
});

test('parallel gates may share read controls but neither may write another gate control', () => {
  let draft = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  draft = controlCircuit(draft, 'r1', 'left', 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 0);
  draft = controlCircuit(draft, 'r1', 'left', 0, 1, [draft.rules[0].left[1].id]);
  assert.deepEqual(draft.rules[0].left.map(operation => operation.controls), [
    [{ wire: 0, value: 1 }], [{ wire: 0, value: 1 }],
  ]);
  assert.throws(() => placeGate(draft, 'r1', 'left', 'g1', 0, 0), /overlap/);
  const reversed = structuredClone(draft);
  reversed.rules[0].left.reverse();
  assert.doesNotThrow(() => normalizeDraft(reversed));
  for (const reverse of [false, true]) {
    const invalid = structuredClone(draft);
    invalid.rules[0].left[1].controls = [{ wire: 1, value: 1 }];
    if (reverse) invalid.rules[0].left.reverse();
    assert.throws(() => normalizeDraft(invalid), /overlap/);
  }
});

test('different polycontrol values and nesting orders require separate columns', () => {
  let draft = placeGate(controlledExample('Polycontrolled PROP'), 'r1', 'left', 'g1', 1, 0);
  draft = controlCircuit(draft, 'r1', 'left', 0, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 0);
  const second = draft.rules[0].left[1];
  const before = serializeDraft(draft);
  assert.throws(() => controlCircuit(draft, 'r1', 'left', 0, 1, [second.id]), /different control contexts need separate columns/);
  assert.equal(serializeDraft(draft), before);
  const separate = placeGate(draft, 'r1', 'left', 'g1', 2, 1, { ruleId: 'r1', side: 'left', id: second.id });
  const controlled = controlCircuit(separate, 'r1', 'left', 0, 1, [second.id]);
  assert.deepEqual(controlled.rules[0].left.map(operation => operation.controls), [
    [{ wire: 0, value: 0 }], [{ wire: 0, value: 1 }],
  ]);

  let nested = placeGate(controlledExample('Polycontrolled PROP'), 'r1', 'left', 'g1', 2, 0);
  const firstId = nested.rules[0].left[0].id;
  nested = controlCircuit(nested, 'r1', 'left', 1, 1, [firstId]);
  nested = controlCircuit(nested, 'r1', 'left', 0, 0, [firstId]);
  nested = placeGate(nested, 'r1', 'left', 'g1', 3, 1);
  const secondId = nested.rules[0].left[1].id;
  nested = controlCircuit(nested, 'r1', 'left', 0, 0, [secondId]);
  nested = controlCircuit(nested, 'r1', 'left', 1, 1, [secondId]);
  assert.deepEqual(nested.rules[0].left.map(operation => operation.controls), [
    [{ wire: 0, value: 0 }, { wire: 1, value: 1 }],
    [{ wire: 1, value: 1 }, { wire: 0, value: 0 }],
  ]);
  assert.deepEqual(parseDraft(serializeDraft(nested)), nested);
  const nestedBefore = serializeDraft(nested);
  assert.throws(() => placeGate(nested, 'r1', 'left', 'g1', 3, 0,
    { ruleId: 'r1', side: 'left', id: secondId }), /different control contexts need separate columns/);
  assert.equal(serializeDraft(nested), nestedBefore);
  const matching = structuredClone(nested);
  matching.rules[0].left[1].controls = structuredClone(matching.rules[0].left[0].controls);
  matching.rules[0].left[1].column = 0;
  assert.doesNotThrow(() => normalizeDraft(matching));
});

test('a common outer control preserves parallel bodies with disjoint inner control contexts', () => {
  let draft = placeGate(controlledExample('Polycontrolled PROP'), 'r1', 'left', 'g1', 1, 0);
  const firstId = draft.rules[0].left[0].id;
  draft = controlCircuit(draft, 'r1', 'left', 0, 0, [firstId]);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 0);
  const secondId = draft.rules[0].left[1].id;
  draft = controlCircuit(draft, 'r1', 'left', 3, 1, [secondId]);
  const before = serializeDraft(draft);
  const controlled = controlCircuit(draft, 'r1', 'left', 'above');
  assert.equal(controlled.rules[0].wires, 5);
  assert.deepEqual(controlled.rules[0].left.map(operation => ({ wire: operation.wire, column: operation.column, controls: operation.controls })), [
    { wire: 2, column: 0, controls: [{ wire: 0, value: 1 }, { wire: 1, value: 0 }] },
    { wire: 3, column: 0, controls: [{ wire: 0, value: 1 }, { wire: 4, value: 1 }] },
  ]);
  assert.equal(serializeDraft(draft), before);
  assert.deepEqual(parseDraft(serializeDraft(controlled)), controlled);
});

test('moving controlled gates translates every control, preserves ids, and rejects out-of-bounds moves atomically', () => {
  let draft = placeGate(controlledExample('Polycontrolled PROP', 5), 'r1', 'left', 'g1', 2, 5);
  draft = controlCircuit(draft, 'r1', 'left', 0, 0);
  draft = controlCircuit(draft, 'r1', 'left', 1, 1);
  const operation = draft.rules[0].left[0];
  const source = { ruleId: 'r1', side: 'left', id: operation.id };
  const before = serializeDraft(draft);
  for (const action of [placeGate, insertGate]) {
    const moved = action(draft, 'r1', 'right', 'g1', 3, 0, source);
    assert.equal(moved.rules[0].right[0].id, operation.id);
    assert.deepEqual(moved.rules[0].right[0].controls, [{ wire: 2, value: 1 }, { wire: 1, value: 0 }]);
    assert.deepEqual(moved.rules[0].left, []);
    assert.throws(() => action(draft, 'r1', 'right', 'g1', 1, 0, source), /control wire/);
    assert.equal(serializeDraft(draft), before);
  }
  const movedCell = placeGate(draft, 'r1', 'left', 'g1', 3, 9, source);
  assert.equal(movedCell.rules[0].left[0].column, 9);
  assert.deepEqual(movedCell.rules[0].left[0].controls, [{ wire: 2, value: 1 }, { wire: 1, value: 0 }]);
  assert.equal(Object.hasOwn(placeGate(draft, 'r1', 'right', 'g1', 3, 0).rules[0].right[0], 'controls'), false);

  let high = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  high = controlCircuit(high, 'r1', 'left', 3);
  const highSource = { ruleId: 'r1', side: 'left', id: high.rules[0].left[0].id };
  assert.throws(() => placeGate(high, 'r1', 'right', 'g1', 2, 0, highSource), /control wire/);
});

test('arity, wire-count, and category changes cannot invalidate existing controls or structural gates', () => {
  let draft = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  draft = controlCircuit(draft, 'r1', 'left', 2);
  const before = serializeDraft(draft);
  assert.throws(() => updateGenerator(draft, 'g1', { arity: 2 }), /disjoint/);
  assert.throws(() => updateRule(draft, 'r1', { wires: 2 }), /control wire/);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'PRO' }), /does not support controls/);
  assert.doesNotThrow(() => normalizeDraft({ ...draft, structure: 'Polycontrolled PROP' }));
  assert.throws(() => controlCircuit(draft, 'r1', 'left', 0, 0), /control value/);
  assert.equal(serializeDraft(draft), before);
  const swap = placeGate(controlledExample(), 'r1', 'left', '$swap', 1, 0);
  const controlledSwap = controlCircuit(swap, 'r1', 'left', 0);
  assert.deepEqual(controlledSwap.rules[0].left[0].controls, [{ wire: 0, value: 1 }]);
  assert.throws(() => normalizeDraft({ ...controlledSwap, structure: 'PROP' }), /does not support controls/);
  assert.doesNotThrow(() => exportTheory({ ...removeControls(controlledSwap, 'r1', 'left'), structure: 'PROP' }));
});

test('controlling a selected composite requires closure and an untouched control wire over its range', () => {
  let draft = controlledExample();
  draft = placeGate(draft, 'r1', 'left', 'g1', 1, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 1, 2);
  const ids = draft.rules[0].left.map(operation => operation.id);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 1);
  draft = placeGate(draft, 'r1', 'left', 'g1', 0, 3);
  const controlled = controlCircuit(draft, 'r1', 'left', 0, 1, ids);
  assert.deepEqual(controlled.rules[0].left.map(operation => operation.controls ?? []), [
    [{ wire: 0, value: 1 }], [{ wire: 0, value: 1 }], [], [],
  ]);
  const before = serializeDraft(draft);
  const interrupted = placeGate(draft, 'r1', 'left', 'g1', 1, 1);
  assert.throws(() => controlCircuit(interrupted, 'r1', 'left', 0, 1, ids), /closed circuit/);
  const controlWritten = placeGate(draft, 'r1', 'left', 'g1', 0, 1);
  assert.throws(() => controlCircuit(controlWritten, 'r1', 'left', 0, 1, ids), /control wire must stay untouched/);
  const bodyRead = controlCircuit(draft, 'r1', 'left', 1, 1, [draft.rules[0].left[2].id]);
  assert.throws(() => controlCircuit(bodyRead, 'r1', 'left', 0, 1, ids), /closed circuit/);
  const bodyControlWritten = structuredClone(draft);
  for (const operation of bodyControlWritten.rules[0].left.slice(0, 2)) operation.controls = [{ wire: 2, value: 1 }];
  assert.throws(() => controlCircuit(bodyControlWritten, 'r1', 'left', 0, 1, ids), /closed circuit/);
  assert.equal(serializeDraft(draft), before);
});

test('new control wires shift both sides above the diagram while scalar anchors remain zero', () => {
  let draft = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  draft = placeGate(draft, 'r1', 'right', 'g1', 1, 0);
  draft = controlCircuit(draft, 'r1', 'left', 0);
  draft = controlCircuit(draft, 'r1', 'right', 0);
  const before = serializeDraft(draft);
  const above = controlCircuit(draft, 'r1', 'left', 'above');
  assert.equal(above.rules[0].wires, 5);
  assert.equal(above.rules[0].left[0].wire, 2);
  assert.equal(above.rules[0].right[0].wire, 2);
  assert.deepEqual(above.rules[0].left[0].controls, [{ wire: 0, value: 1 }, { wire: 1, value: 1 }]);
  assert.deepEqual(above.rules[0].right[0].controls, [{ wire: 1, value: 1 }]);
  assert.equal(serializeDraft(draft), before);

  let scalar = addGenerator({ ...createTheory(), structure: 'Polycontrolled PROP', controlValues: 3 }, { name: 's', arity: 0 });
  scalar = addRule(scalar, { name: 'Scalar', wires: 0 });
  scalar = placeGate(scalar, 'r1', 'left', 'g1', 0, 0);
  scalar = placeGate(scalar, 'r1', 'right', 'g1', 0, 0);
  scalar = controlCircuit(scalar, 'r1', 'left', 'above', 2);
  scalar = controlCircuit(scalar, 'r1', 'left', 'below', 0);
  assert.equal(scalar.rules[0].wires, 2);
  assert.equal(scalar.rules[0].left[0].wire, 0);
  assert.equal(scalar.rules[0].right[0].wire, 0);
  assert.deepEqual(scalar.rules[0].left[0].controls, [{ wire: 1, value: 0 }, { wire: 0, value: 2 }]);
  assert.deepEqual(touchedWires(scalar.rules[0].left[0], new Map(availableGates(scalar).map(gate => [gate.id, gate]))), [1, 0]);
  const cleared = removeControls(scalar, 'r1', 'left');
  assert.equal(cleared.rules[0].wires, 2);
  assert.equal(Object.hasOwn(cleared.rules[0].left[0], 'controls'), false);
  assert.deepEqual(parseDraft(serializeDraft(scalar)), scalar);
});

test('control selection, nesting, and new-wire limits fail without changing history', () => {
  let draft = placeGate(controlledExample(), 'r1', 'left', 'g1', 1, 0);
  draft = placeGate(draft, 'r1', 'left', 'g1', 2, 1);
  const ids = draft.rules[0].left.map(operation => operation.id);
  const before = serializeDraft(draft);
  for (const operationIds of [[], [ids[0], ids[0]], ['absent'], {}, 'all']) {
    assert.throws(() => controlCircuit(draft, 'r1', 'left', 'above', 1, operationIds), RangeError);
    assert.throws(() => removeControls(draft, 'r1', 'left', operationIds), RangeError);
  }
  const controlled = controlCircuit(draft, 'r1', 'left', 0);
  assert.throws(() => controlCircuit(controlled, 'r1', 'left', 0), /unique/);
  const onlyFirst = removeControls(controlled, 'r1', 'left', [ids[0]]);
  assert.equal(Object.hasOwn(onlyFirst.rules[0].left[0], 'controls'), false);
  assert.deepEqual(onlyFirst.rules[0].left[1].controls, [{ wire: 0, value: 1 }]);
  for (const wire of [-1, .5, 4, 'middle', undefined]) {
    assert.throws(() => controlCircuit(draft, 'r1', 'left', wire), /control wire/);
  }
  assert.throws(() => controlCircuit(updateRule(draft, 'r1', { wires: 6 }), 'r1', 'left', 'above'), /wire count/);
  assert.throws(() => controlCircuit({ ...draft, structure: 'PROP' }, 'r1', 'left', 'above'), /does not support controls/);
  assert.equal(serializeDraft(draft), before);
});
