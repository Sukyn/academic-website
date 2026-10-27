import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, availableGates, createTheory, normalizeDraft, addGenerator, updateGenerator, removeGenerator,
  addRule, addShortcut, updateShortcut, removeShortcut, placeGate, insertGate, removeGate, removeGates,
  controlCircuit, removeControls, exportTheory, serializeDraft, parseDraft,
} from '../src/lib/minimality/model.js';

function example(structure = 'PRO') {
  let draft = addGenerator({ ...createTheory(), structure }, { name: 'H', arity: 1 });
  draft = addGenerator(draft, { name: 'Z', arity: 1 });
  draft = addShortcut(draft, { name: 'X', wires: 1 });
  for (const [column, generator] of ['g1', 'g2', 'g1'].entries()) draft = placeGate(draft, 's1', 'left', generator, 0, column);
  return addRule(draft, { name: 'Involution', wires: 3 });
}

test('shortcuts expand into primitive gates without adding generators or equations', () => {
  let draft = example();
  draft = placeGate(draft, 'r1', 'left', 's1', 2, 2);
  draft = placeGate(draft, 'r1', 'left', 'g2', 2, 5);
  const before = serializeDraft(draft);
  assert.deepEqual(availableGates(draft).find(gate => gate.id === 's1'), { id: 's1', name: 'X', arity: 1, shortcut: true });
  assert.deepEqual(exportTheory(draft), {
    name: 'Untitled theory', generators: { H: { type: 1 }, Z: { type: 1 } },
    equations: [{ id: 'Involution', lhs: { wires: 3, ops: [
      { gen: 'H', on: [2] }, { gen: 'Z', on: [2] }, { gen: 'H', on: [2] }, { gen: 'Z', on: [2] },
    ] }, rhs: { wires: 3, ops: [] } }],
  });
  assert.equal(serializeDraft(draft), before);
});

test('nested shortcuts preserve whole-call execution order and offset multiwire gates and swaps', () => {
  let draft = example('PROP');
  draft = addShortcut(draft, { name: 'Pair', wires: 2 });
  draft = placeGate(draft, 's2', 'left', 's1', 1, 3);
  draft = placeGate(draft, 's2', 'left', '$swap', 0, 7);
  draft = placeGate(draft, 's2', 'left', 'g2', 0, 12);
  draft = placeGate(draft, 'r1', 'left', 's2', 1, 0);
  draft = placeGate(draft, 'r1', 'left', 'g2', 0, 0);
  draft = placeGate(draft, 'r1', 'left', 's1', 2, 1);
  assert.deepEqual(exportTheory(draft).equations[0].lhs.ops, [
    { gen: 'Z', on: [0] },
    { gen: 'H', on: [2] }, { gen: 'Z', on: [2] }, { gen: 'H', on: [2] },
    { perm: [0, 2, 1] }, { gen: 'Z', on: [1] },
    { gen: 'H', on: [2] }, { gen: 'Z', on: [2] }, { gen: 'H', on: [2] },
  ]);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'PRO' }), /crossing/);
});

test('shortcut definitions use the same atomic placement, insertion, move, and removal APIs', () => {
  let draft = example();
  const source = { ruleId: 's1', side: 'left', id: draft.shortcuts[0].left[1].id };
  const before = serializeDraft(draft);
  const moved = insertGate(draft, 'r1', 'right', 'g2', 2, 0, source);
  assert.equal(moved.rules[0].right[0].id, source.id);
  assert.deepEqual(moved.shortcuts[0].left.map(operation => operation.column), [0, 1]);
  const returned = placeGate(moved, 's1', 'left', 'g2', 0, 4,
    { ruleId: 'r1', side: 'right', id: source.id });
  assert.deepEqual(returned.rules[0].right, []);
  assert.equal(returned.shortcuts[0].left.at(-1).id, source.id);
  assert.deepEqual(removeGate(returned, 's1', 'left', source.id).shortcuts[0].left.map(operation => operation.column), [0, 1]);
  assert.throws(() => placeGate(draft, 's1', 'left', 'g1', 1, 5), /does not fit/);
  for (const action of [placeGate, insertGate]) {
    assert.throws(() => action(draft, 's1', 'right', 'g1', 0, 0), /left side of a shortcut/);
    assert.throws(() => action(draft, 'r1', 'right', 'g1', 0, 0, { ...source, side: 'right' }), /left side of a shortcut/);
  }
  assert.throws(() => removeGate(draft, 's1', 'right', source.id), /left side of a shortcut/);
  assert.equal(serializeDraft(draft), before);
});

test('editing and deleting used definitions or primitive generators cannot invalidate a theory', () => {
  let draft = placeGate(example(), 'r1', 'left', 's1', 2, 0);
  const before = serializeDraft(draft);
  assert.throws(() => removeShortcut(draft, 's1'), /Remove this shortcut/);
  assert.throws(() => removeGenerator(draft, 'g1'), /shortcut definitions/);
  assert.throws(() => updateGenerator(draft, 'g1', { arity: 2 }), /does not fit/);
  assert.throws(() => updateShortcut(draft, 's1', { wires: 2 }), /does not fit/);
  assert.throws(() => updateShortcut(draft, 's1', { wires: 0 }), /does not fit/);
  const renamed = updateShortcut(draft, 's1', { name: ' PX ' });
  assert.equal(availableGates(renamed).find(gate => gate.id === 's1').name, 'PX');
  assert.deepEqual(exportTheory(renamed), exportTheory(draft));
  assert.equal(serializeDraft(draft), before);
  draft = removeGate(draft, 'r1', 'left', draft.rules[0].left[0].id);
  draft = addShortcut(draft, { name: 'N', wires: 1 });
  draft = placeGate(draft, 's2', 'left', 's1', 0, 0);
  assert.throws(() => removeShortcut(draft, 's1'), /other shortcut definitions/);
  draft = removeShortcut(draft, 's2');
  assert.equal(Object.hasOwn(removeShortcut(draft, 's1'), 'shortcuts'), false);
});

test('batch deletion edits shortcut bodies atomically and preserves calls when a definition becomes identity', () => {
  const draft = placeGate(example(), 'r1', 'left', 's1', 2, 4), before = structuredClone(draft);
  const [first, middle, last] = draft.shortcuts[0].left;
  const removed = removeGates(draft, 's1', 'left', [first.id, last.id]);
  assert.deepEqual(removed, removeGate(removeGate(draft, 's1', 'left', first.id), 's1', 'left', last.id));
  assert.deepEqual(removed.shortcuts[0].left, [{ ...middle, column: 0 }]);
  assert.deepEqual(exportTheory(removed).equations[0].lhs.ops, [{ gen: 'Z', on: [2] }]);
  const identity = removeGates(draft, 's1', 'left');
  assert.deepEqual(identity.shortcuts[0].left, []);
  assert.equal(identity.shortcuts[0].wires, 1);
  assert.deepEqual(identity.rules, draft.rules);
  assert.deepEqual(exportTheory(identity).equations[0].lhs.ops, []);
  assert.throws(() => removeGates(draft, 's1', 'right', [first.id]), /left side of a shortcut/);
  assert.throws(() => removeGates(draft, 's1', 'right'), /left side of a shortcut/);
  assert.throws(() => removeGates(draft, 's1', 'left', [first.id, 'missing']), /gate on this side/);
  assert.deepEqual(draft, before);
});

test('every definition is validated and direct or indirect cycles fail even when unused', () => {
  let draft = addShortcut(example(), { name: 'Y', wires: 1 });
  const before = serializeDraft(draft);
  assert.throws(() => placeGate(draft, 's2', 'left', 's2', 0, 0), /cannot refer to themselves/);
  draft = placeGate(draft, 's2', 'left', 's1', 0, 0);
  assert.throws(() => placeGate(draft, 's1', 'left', 's2', 0, 5), /cannot refer to themselves/);
  assert.equal(serializeDraft(removeGate(draft, 's2', 'left', draft.shortcuts[1].left[0].id)), before);
  const unknown = structuredClone(draft);
  unknown.shortcuts[0].left[0].generator = 'missing';
  assert.throws(() => normalizeDraft(unknown), /generator in this theory/);
  const invalidRight = structuredClone(draft);
  invalidRight.shortcuts[0].right = [{ id: 'unreachable', generator: 'g1', wire: 0, column: 0 }];
  assert.throws(() => normalizeDraft(invalidRight), /unused right side/);
});

test('shortcut and generator names share one namespace and all IDs are globally unique', () => {
  const draft = example();
  for (const action of [
    () => addShortcut(draft, { name: ' H ', wires: 1 }),
    () => addGenerator(draft, { name: 'X', arity: 1 }),
    () => updateGenerator(draft, 'g2', { name: 'X' }),
    () => updateShortcut(draft, 's1', { name: 'Z' }),
    () => addShortcut(draft, { name: 'X', wires: 1 }),
  ]) assert.throws(action, /unique/);
  assert.throws(() => addShortcut(draft, { name: 'x'.repeat(LIMITS.shortcutName + 1), wires: 1 }), /1–32/);
  for (const id of ['g1', 'r1', draft.shortcuts[0].left[0].id]) {
    const invalid = structuredClone(draft);
    invalid.shortcuts[0].id = id;
    assert.throws(() => normalizeDraft(invalid), /unique/);
  }
  const custom = structuredClone(draft);
  custom.shortcuts[0].id = 's2';
  custom.shortcuts[0].left[0].id = 's1';
  assert.equal(addShortcut(custom, { name: 'Y', wires: 1 }).shortcuts.at(-1).id, 's3');
  custom.shortcuts[0].left[0].id = 'o1';
  assert.notEqual(placeGate(custom, 'r1', 'left', 'g1', 0, 0).rules[0].left[0].id, 'o1');
});

test('shortcut names enforce compact rendering and share rendered uniqueness with generators', () => {
  const draft = example(), before = structuredClone(draft);
  for (const raw of ['ABCDE', 'CNOT_dagger', 'H H', '<H>', '🙂', '\\x', 'H^2', 'H_{1}', 'H\u200b']) {
    assert.throws(() => addShortcut(draft, { name: raw, wires: 1 }), /must render as 1–4/);
    assert.throws(() => updateShortcut(draft, 's1', { name: raw }), /must render as 1–4/);
    const invalid = structuredClone(draft);
    invalid.shortcuts[0].name = raw;
    assert.throws(() => parseDraft(JSON.stringify(invalid)), /must render as 1–4/);
    assert.deepEqual(draft, before);
  }
  for (const [primitive, shortcut] of [['omega', 'ω'], ['S_dagger', 'S†'], ['S_inv', 'S⁻¹'], ['minus_one', '−1'], ['CH0', 'CH_zero']]) {
    const named = addGenerator(createTheory(), { name: primitive, arity: 1 });
    assert.throws(() => addShortcut(named, { name: shortcut, wires: 1 }), /unique/);
  }
  const greek = addShortcut(createTheory(), { name: 'omega_dagger', wires: 0 });
  assert.equal(greek.shortcuts[0].name, 'omega_dagger');
  assert.throws(() => addGenerator(greek, { name: 'ω†', arity: 0 }), /unique/);
  const zero = addShortcut(createTheory(), { name: 'CH_zero', wires: 2 });
  assert.equal(zero.shortcuts[0].name, 'CH0');
  assert.throws(() => addShortcut(zero, { name: 'CH0', wires: 2 }), /unique/);
});

test('legacy source aliases migrate without changing IDs, circuits, primitive names, or search semantics', () => {
  const aliases = [
    ['CH_zero', 'CH0'], ['CNOT_zero', 'CX0'], ['Z_zero', 'Z0'], ['CZ_zero', 'CZ0'],
    ['phase_T', 'pT'], ['phase_T_dagger', 'pT_dagger'], ['phase_T_zero', 'pT0'],
  ];
  const legacy = { ...createTheory(), structure: 'PROP', generators: [{ id: 'g', name: 'CNOT', arity: 2 }],
    shortcuts: aliases.map(([name], index) => ({ id: `alias${index}`, name, wires: 2,
      left: [{ id: `body${index}`, generator: 'g', wire: 0, column: 5 }], right: [] })),
    rules: [{ id: 'r', name: 'Legacy aliases', wires: 3,
      left: aliases.map((_, index) => ({ id: `call${index}`, generator: `alias${index}`, wire: 1, column: index })), right: [] }],
  };
  const before = structuredClone(legacy), canonical = normalizeDraft(legacy);
  assert.deepEqual(canonical.shortcuts.map(shortcut => shortcut.name), aliases.map(([, label]) => label));
  assert.deepEqual(canonical.shortcuts.map(({ name, ...record }) => record), legacy.shortcuts.map(({ name, ...record }) => record));
  assert.deepEqual(canonical.generators, legacy.generators);
  assert.deepEqual(canonical.rules, legacy.rules);
  assert.deepEqual(parseDraft(JSON.stringify(legacy)), canonical);
  const packed = JSON.parse(serializeDraft(canonical));
  packed.shortcuts = legacy.shortcuts.map(shortcut => [shortcut.id, shortcut.name, shortcut.wires,
    shortcut.left.map(operation => [operation.id, operation.generator, operation.wire, operation.column])]);
  assert.deepEqual(parseDraft(JSON.stringify(packed)), canonical);
  assert.deepEqual(parseDraft(serializeDraft(canonical)), canonical);
  assert.deepEqual(exportTheory(canonical), exportTheory(legacy));
  assert.deepEqual(exportTheory(canonical).equations[0].lhs.ops, aliases.map(() => ({ gen: 'CNOT', on: [1, 2] })));
  assert.deepEqual(Object.keys(exportTheory(canonical).generators), ['CNOT']);
  assert.deepEqual(legacy, before);
  const collision = structuredClone(legacy);
  collision.shortcuts[1].name = 'CH0';
  assert.throws(() => normalizeDraft(collision), /unique/);
});

test('editable saves use compact optional shortcut tuples and retain legacy byte shapes when empty', () => {
  const empty = createTheory();
  assert.equal(serializeDraft({ ...empty, shortcuts: [] }), serializeDraft(empty));
  assert.deepEqual(normalizeDraft({ ...empty, shortcuts: [] }), empty);
  let draft = example();
  draft = addShortcut(draft, { name: 'I2', wires: 2 });
  const packed = JSON.parse(serializeDraft(draft));
  assert.deepEqual(packed.shortcuts, [
    ['s1', 'X', 1, [['o1', 'g1', 0, 0], ['o2', 'g2', 0, 1], ['o3', 'g1', 0, 2]]],
    ['s2', 'I2', 2],
  ]);
  assert.deepEqual(parseDraft(JSON.stringify(draft)), draft);
  assert.deepEqual(parseDraft(JSON.stringify(packed)), draft);
  const detached = parseDraft(JSON.stringify(packed));
  detached.shortcuts[0].left[0].column = 15;
  assert.equal(draft.shortcuts[0].left[0].column, 0);
  assert.equal(packed.shortcuts[0][3][0][3], 0);
});

test('scalar and identity shortcuts retain declared footprints but export only their primitive bodies', () => {
  let draft = addGenerator(createTheory(), { name: 'ω', arity: 0 });
  draft = addShortcut(draft, { name: 'p', wires: 0 });
  draft = placeGate(draft, 's1', 'left', 'g1', 0, 0);
  draft = addShortcut(draft, { name: 'I2', wires: 2 });
  draft = addShortcut(draft, { name: 'pP', wires: 2 });
  draft = placeGate(draft, 's3', 'left', 's1', 0, 0);
  draft = addRule(draft, { name: 'Scalars', wires: 4 });
  draft = placeGate(draft, 'r1', 'left', 's3', 2, 0);
  draft = placeGate(draft, 'r1', 'left', 's2', 0, 0);
  draft = placeGate(draft, 'r1', 'right', 's1', 0, 0);
  assert.deepEqual(exportTheory(draft).equations[0], {
    id: 'Scalars', lhs: { wires: 4, ops: [{ gen: 'ω', on: [] }] }, rhs: { wires: 4, ops: [{ gen: 'ω', on: [] }] },
  });
  assert.throws(() => placeGate(draft, 'r1', 'left', 's2', 3, 2), /does not fit/);
  assert.throws(() => placeGate(draft, 'r1', 'right', 's1', 3, 2), /wire 0/);
  assert.throws(() => placeGate(draft, 'r1', 'right', 's1', 0, 0), /Only one scalar/);
});

test('definitions support nested controls, category validation, atomic arity changes, and save/open', () => {
  let draft = example('Polycontrolled PROP');
  draft = updateShortcut(draft, 's1', { wires: 2 });
  draft = controlCircuit(draft, 's1', 'left', 1, 1);
  draft = controlCircuit(draft, 's1', 'left', 'above', 0);
  assert.equal(draft.shortcuts[0].wires, 3);
  assert.deepEqual(draft.shortcuts[0].left[0].controls, [{ wire: 0, value: 0 }, { wire: 2, value: 1 }]);
  draft = placeGate(draft, 'r1', 'left', 's1', 0, 0);
  assert.deepEqual(parseDraft(serializeDraft(draft)), draft);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'PROP' }), /does not support controls/);
  assert.throws(() => normalizeDraft({ ...draft, structure: 'Controlled PROP' }), /control value/);
  assert.throws(() => exportTheory(draft), /supports PRO and PROP/);
  const before = serializeDraft(draft);
  assert.throws(() => controlCircuit(draft, 's1', 'left', 'below', 1), /does not fit/);
  assert.equal(serializeDraft(draft), before);
  const cleared = removeControls(draft, 's1', 'left');
  assert.equal(cleared.shortcuts[0].left[0].controls, undefined);
  assert.doesNotThrow(() => exportTheory({ ...cleared, structure: 'PROP' }));
});

test('export bounds recursive expansion before allocating oversized sides and memoizes identity bodies', () => {
  let draft = example();
  draft = addShortcut(draft, { name: 'Four', wires: 1 });
  for (let column = 0; column < 4; column++) draft = placeGate(draft, 's2', 'left', 'g1', 0, column);
  draft = addShortcut(draft, { name: 'E8', wires: 1 });
  for (let column = 0; column < 2; column++) draft = placeGate(draft, 's3', 'left', 's2', 0, column);
  for (let column = 0; column < LIMITS.expandedGates / 8; column++) draft = placeGate(draft, 'r1', 'left', 's3', 0, column);
  assert.equal(exportTheory(draft).equations[0].lhs.ops.length, LIMITS.expandedGates);
  draft = placeGate(draft, 'r1', 'left', 'g1', 1, 0);
  const before = serializeDraft(draft);
  assert.throws(() => exportTheory(draft), new RegExp(`After expanding shortcuts.*at most ${LIMITS.expandedGates} gates`));
  assert.equal(serializeDraft(draft), before);
  const identity = { ...createTheory(), structure: 'PROP',
    shortcuts: Array.from({ length: LIMITS.shortcuts }, (_, index) => ({
      id: `s${index}`, name: `I${index}`, wires: 6, right: [],
      left: index ? Array.from({ length: LIMITS.columns }, (_, column) =>
        ({ id: `body${index}_${column}`, generator: `s${index - 1}`, wire: 0, column })) : [],
    })), rules: [{ id: 'r', name: 'Identity', wires: 6, left: [{ id: 'call', generator: `s${LIMITS.shortcuts - 1}`, wire: 0, column: 0 }], right: [] }],
  };
  assert.deepEqual(exportTheory(identity).equations[0].lhs.ops, []);
});

test('shortcut import rejects malformed tuples, bodies, cycles, unknown fields, and collection limits', () => {
  const packed = JSON.parse(serializeDraft(example()));
  for (const shortcuts of [undefined, null, {}, [null], [['s1', 'X']], [['s1', 'X', 1, [], []]],
    [['s1', 'X', 1, null]], [['s1', 'X', 1, [['self', 's1', 0, 0]]]], Array(LIMITS.shortcuts + 1)]) {
    assert.throws(() => normalizeDraft({ ...packed, shortcuts }), RangeError);
  }
  const invalid = example();
  invalid.shortcuts[0].extra = true;
  assert.throws(() => normalizeDraft(invalid), /unsupported fields/);
  const full = createTheory();
  for (let index = 0; index < LIMITS.shortcuts; index++) Object.assign(full, addShortcut(full, { name: `S${index}`, wires: 1 }));
  assert.throws(() => addShortcut(full, { name: 'Full', wires: 1 }), /at most 12/);
});
