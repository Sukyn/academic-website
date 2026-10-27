import { integer, list, tuple, name, gateLabel, parseJSON } from './validation.js';

/** Pure editor state for circuit equations. */
export const LIMITS = Object.freeze({
  wires: 6, generators: 12, shortcuts: 12, rules: 24, columns: 16, gates: 64, expandedGates: 128,
  theoryName: 120, generatorName: 32, shortcutName: 32, ruleName: 64, bytes: 256_000,
});
export const STRUCTURES = Object.freeze(['PRO', 'PROP', 'Braided', 'Controlled PROP', 'Polycontrolled PROP']);

export function supportsControls(structure) {
  return structure === 'Controlled PROP' || structure === 'Polycontrolled PROP';
}

/** Structural gates belong to the chosen category, rather than its presentation. */
export function availableGates(draft) {
  const structural = draft.structure === 'Braided'
    ? [
      { id: '$braid', name: 'Braid', arity: 2, kind: 'braid' },
      { id: '$braid-inverse', name: 'Braid inverse', arity: 2, kind: 'braid-inverse' },
    ]
    : draft.structure === 'PROP' || supportsControls(draft.structure)
      ? [{ id: '$swap', name: 'Swap', arity: 2, kind: 'swap' }]
      : [];
  return [...draft.generators, ...(draft.shortcuts ?? []).map(({ id, name, wires }) =>
    ({ id, name, arity: wires, shortcut: true })), ...structural];
}

const gateMap = draft => new Map(availableGates(draft).map(gate => [gate.id, gate]));

export function targetWires(operation, gatesMap) {
  const gate = gatesMap.get(operation.generator);
  if (!gate) throw new RangeError('Every gate must use a generator in this theory.');
  return Array.from({ length: gate.arity }, (_, offset) => operation.wire + offset);
}

export function touchedWires(operation, gatesMap) {
  return [...new Set([...targetWires(operation, gatesMap), ...(operation.controls ?? []).map(control => control.wire)])];
}

function keys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError(`${label} must be an object.`);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RangeError(`${label} contains unsupported fields.`);
}
function identifier(value, label, used) {
  if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new RangeError(`${label} must be a short identifier starting with a letter.`);
  return unique(value, used, label);
}
function unique(value, used, label) {
  if (used.has(value)) throw new RangeError(`${label} must be unique.`);
  used.add(value);
  return value;
}
function sideName(side) {
  if (side !== 'left' && side !== 'right') throw new RangeError('Choose the left or right side of an equation.');
}

export function createTheory() {
  return { version: 1, name: 'Untitled theory', structure: 'PRO', controlValues: 2, generators: [], rules: [] };
}

function expandDraft(value) {
  const side = operations => Array.from(list(operations, LIMITS.gates, 'Gates on each side'), entry => {
    const [id, generator, wire, column] = tuple(entry, 4, 5, 'A gate');
    const controls = entry.length === 5 ? { controls: Array.from(list(entry[4], LIMITS.wires, 'Gate controls'), control => {
      tuple(control, 2, 2, 'A control');
      return { wire: control[0], value: control[1] };
    }) } : {};
    return { id, generator, wire, column, ...controls };
  });
  return {
    ...value, version: 1,
    generators: Array.from(list(value.generators, LIMITS.generators, 'Generators'), entry => {
      const [id, name, arity] = tuple(entry, 3, 3, 'A generator');
      return { id, name, arity };
    }),
    rules: Array.from(list(value.rules, LIMITS.rules, 'Equations'), entry => {
      const [id, name, wires] = tuple(entry, 3, 5, 'An equation');
      return { id, name, wires, left: side(entry.length > 3 ? entry[3] : []), right: side(entry.length > 4 ? entry[4] : []) };
    }),
    ...(Object.hasOwn(value, 'shortcuts') ? { shortcuts: Array.from(list(value.shortcuts, LIMITS.shortcuts, 'Shortcuts'), entry => {
      const [id, name, wires] = tuple(entry, 3, 4, 'A shortcut');
      return { id, name, wires, left: side(entry.length > 3 ? entry[3] : []), right: [] };
    }) } : {}),
  };
}

/** Validate saved/editor data, detach all arrays, and strip incidental whitespace. */
export function normalizeDraft(value) {
  keys(value, ['version', 'name', 'structure', 'controlValues', 'generators', 'rules', 'shortcuts'], 'The theory');
  if (value.version === 2) value = expandDraft(value);
  if (value.version !== 1) throw new RangeError('This editor supports draft versions 1 and 2.');
  const structure = Object.hasOwn(value, 'structure') ? value.structure : 'PRO';
  if (!STRUCTURES.includes(structure)) throw new RangeError('Choose a supported categorical structure.');
  const controlValues = integer(Object.hasOwn(value, 'controlValues') ? value.controlValues : 2, 2, 6, 'The number of control values');
  const ids = new Set(), generatorNames = new Set(), ruleNames = new Set();
  const namedGate = (value, label, limit, shortcut = false) => {
    const gate = gateLabel(value, label, limit, shortcut);
    unique(gate.display, generatorNames, shortcut ? 'Generator and shortcut names' : 'Generator names');
    return gate.name;
  };
  const generators = list(value.generators, LIMITS.generators, 'Generators').map(entry => {
    keys(entry, ['id', 'name', 'arity'], 'A generator');
    return {
      id: identifier(entry.id, 'Generator IDs', ids),
      name: namedGate(entry.name, 'A generator name', LIMITS.generatorName),
      arity: integer(entry.arity, 0, LIMITS.wires, 'A generator arity'),
    };
  });
  const shortcutEntries = Object.hasOwn(value, 'shortcuts') ? list(value.shortcuts, LIMITS.shortcuts, 'Shortcuts') : [];
  const ruleEntries = list(value.rules, LIMITS.rules, 'Equations');
  const header = (entry, shortcut) => {
    const label = shortcut ? 'A shortcut' : 'An equation';
    keys(entry, ['id', 'name', 'wires', 'left', 'right'], label);
    return {
      id: identifier(entry.id, shortcut ? 'Shortcut IDs' : 'Equation IDs', ids),
      name: shortcut ? namedGate(entry.name, `${label} name`, LIMITS.shortcutName, true)
        : unique(name(entry.name, `${label} name`, LIMITS.ruleName), ruleNames, 'Equation names'),
      wires: integer(entry.wires, 0, LIMITS.wires, `${label} wire count`),
    };
  };
  const shortcuts = shortcutEntries.map(entry => header(entry, true));
  const rules = ruleEntries.map(entry => header(entry, false));
  const byId = gateMap({ structure, generators, shortcuts });
  const body = (entry, record, shortcut) => {
    const { wires } = record;
    const normalizeSide = side => {
      const targets = new Set(), reads = new Map(), scalars = new Set();
      return list(entry[side], LIMITS.gates, 'Gates on each side').map(operation => {
        keys(operation, ['id', 'generator', 'wire', 'column', 'controls'], 'A gate');
        const operationId = identifier(operation.id, 'Gate IDs', ids);
        const generator = byId.get(operation.generator);
        if (!generator) {
          if (['$swap', '$braid', '$braid-inverse'].includes(operation.generator)) {
            throw new RangeError('This categorical structure does not support that crossing. Remove it before changing structure.');
          }
          throw new RangeError('Every gate must use a generator in this theory.');
        }
        const column = integer(operation.column, 0, LIMITS.columns - 1, 'A gate column');
        const wire = integer(operation.wire, 0, LIMITS.wires - 1, 'A gate starting wire');
        const controlWires = new Set();
        const controls = Object.hasOwn(operation, 'controls') ? list(operation.controls, LIMITS.wires, 'Gate controls').map(control => {
          if (!supportsControls(structure)) throw new RangeError('This categorical structure does not support controls.');
          keys(control, ['wire', 'value'], 'A control');
          return {
            wire: unique(integer(control.wire, 0, wires - 1, 'A control wire'), controlWires, 'Control wires'),
            value: integer(control.value, structure === 'Controlled PROP' ? 1 : 0,
              structure === 'Controlled PROP' ? 1 : controlValues - 1, 'A control value'),
          };
        }) : [];
        if (generator.arity === 0) {
          if (wire !== 0) throw new RangeError('Place scalar generators at wire 0.');
          if (scalars.has(column)) throw new RangeError('Only one scalar gate can occupy a column.');
          scalars.add(column);
        } else {
          if (wire + generator.arity > wires) throw new RangeError(`The generator ${generator.name} does not fit on this equation's wires.`);
        }
        const result = { id: operationId, generator: generator.id, wire, column, ...(controls.length ? { controls } : {}) };
        for (const target of targetWires(result, byId)) {
          if (controlWires.has(target)) throw new RangeError('Control wires must be disjoint from the gate targets.');
          const key = `${column}:${target}`;
          if (targets.has(key) || reads.has(key)) throw new RangeError('Gates cannot overlap on the same wire and column.');
          targets.add(key);
        }
        let context = '';
        for (const control of controls) {
          // Shared wires must belong to the same nested outer constructor.
          context += `${control.wire}:${control.value},`;
          const key = `${column}:${control.wire}`;
          if (targets.has(key)) throw new RangeError('Gates cannot overlap on the same wire and column.');
          if (reads.has(key) && reads.get(key) !== context) {
            throw new RangeError('Gates with different control contexts need separate columns.');
          }
          reads.set(key, context);
        }
        return result;
      });
    };
    Object.assign(record, { left: normalizeSide('left'), right: shortcut
      ? Array.from(list(entry.right, 0, 'The unused right side of a shortcut')) : normalizeSide('right') });
  };
  shortcuts.forEach((record, index) => body(shortcutEntries[index], record, true));
  rules.forEach((record, index) => body(ruleEntries[index], record, false));
  const definitions = new Map(shortcuts.map(shortcut => [shortcut.id, shortcut]));
  const visited = new Set(), visiting = new Set();
  const visit = shortcut => {
    if (visiting.has(shortcut.id)) throw new RangeError('Shortcuts cannot refer to themselves, directly or through other shortcuts.');
    if (visited.has(shortcut.id)) return;
    visiting.add(shortcut.id);
    for (const operation of shortcut.left) if (definitions.has(operation.generator)) visit(definitions.get(operation.generator));
    visiting.delete(shortcut.id);
    visited.add(shortcut.id);
  };
  shortcuts.forEach(visit);
  return { version: 1, name: name(value.name, 'The theory name', LIMITS.theoryName), structure, controlValues, generators, rules,
    ...(shortcuts.length ? { shortcuts } : {}) };
}

function circuits(draft) {
  return [...draft.rules, ...(draft.shortcuts ?? [])];
}

function usesGate(draft, id) {
  const matches = operation => operation.generator === id;
  return circuits(draft).some(record => record.left.some(matches) || record.right.some(matches));
}

function nextId(draft, prefix) {
  const records = circuits(draft);
  const used = new Set([
    ...draft.generators.map(entry => entry.id), ...records.map(entry => entry.id),
    ...records.flatMap(rule => [...rule.left, ...rule.right].map(entry => entry.id)),
  ]);
  let index = 1;
  while (used.has(prefix + index)) index++;
  return prefix + index;
}
function find(entries, id, label) {
  const result = entries.find(entry => entry.id === id);
  if (!result) throw new RangeError(`Choose an existing ${label}.`);
  return result;
}
function findCircuit(draft, id, side) {
  const record = find(circuits(draft), id, 'equation or shortcut');
  sideName(side);
  if (side === 'right' && draft.shortcuts?.includes(record)) throw new RangeError('Edit the definition on the left side of a shortcut.');
  return record;
}
export function addGenerator(value, details) {
  const draft = normalizeDraft(value);
  keys(details, ['name', 'arity'], 'Generator details');
  draft.generators.push({ id: nextId(draft, 'g'), ...details });
  return normalizeDraft(draft);
}

export function updateGenerator(value, id, details) {
  const draft = normalizeDraft(value);
  keys(details, ['name', 'arity'], 'Generator details');
  Object.assign(find(draft.generators, id, 'generator'), details);
  return normalizeDraft(draft);
}

export function removeGenerator(value, id) {
  const draft = normalizeDraft(value);
  find(draft.generators, id, 'generator');
  if (usesGate(draft, id)) {
    throw new RangeError('Remove this generator\'s gates from the equations first, including shortcut definitions.');
  }
  draft.generators = draft.generators.filter(generator => generator.id !== id);
  return draft;
}

function addCircuit(value, details, shortcut = false) {
  const draft = normalizeDraft(value);
  keys(details, ['name', 'wires'], shortcut ? 'Shortcut details' : 'Equation details');
  const entries = shortcut ? (draft.shortcuts ??= []) : draft.rules;
  entries.push({ id: nextId(draft, shortcut ? 's' : 'r'), ...details, left: [], right: [] });
  return normalizeDraft(draft);
}

function updateCircuit(value, id, details, shortcut = false) {
  const draft = normalizeDraft(value);
  keys(details, ['name', 'wires'], shortcut ? 'Shortcut details' : 'Equation details');
  Object.assign(find((shortcut ? draft.shortcuts : draft.rules) ?? [], id, shortcut ? 'shortcut' : 'equation'), details);
  return normalizeDraft(draft);
}

export function addRule(value, details) { return addCircuit(value, details); }
export function updateRule(value, id, details) { return updateCircuit(value, id, details); }

export function removeRule(value, id) {
  const draft = normalizeDraft(value);
  find(draft.rules, id, 'equation');
  draft.rules = draft.rules.filter(rule => rule.id !== id);
  return draft;
}

export function addShortcut(value, details) { return addCircuit(value, details, true); }
export function updateShortcut(value, id, details) { return updateCircuit(value, id, details, true); }

export function removeShortcut(value, id) {
  const draft = normalizeDraft(value);
  find(draft.shortcuts ?? [], id, 'shortcut');
  if (usesGate(draft, id)) {
    throw new RangeError('Remove this shortcut from the equations and other shortcut definitions first.');
  }
  draft.shortcuts = draft.shortcuts.filter(shortcut => shortcut.id !== id);
  if (!draft.shortcuts.length) delete draft.shortcuts;
  return draft;
}

function positionGate(operation, generator, wire, column) {
  for (const control of operation.controls ?? []) control.wire += wire - operation.wire;
  Object.assign(operation, { generator, wire, column });
}

/** Move an existing gate atomically, or add a fresh gate on contiguous wires. */
export function placeGate(value, ruleId, side, generatorId, wire, column, source) {
  const draft = normalizeDraft(value);
  const rule = findCircuit(draft, ruleId, side);
  if (source) {
    const from = findCircuit(draft, source.ruleId, source.side);
    const operation = find(from[source.side], source.id, 'gate on this side');
    if (from !== rule || source.side !== side) {
      from[source.side] = from[source.side].filter(item => item.id !== operation.id);
      compactSide(from[source.side]);
      rule[side].push(operation);
    }
    positionGate(operation, generatorId, wire, column);
  } else {
    rule[side].push({ id: nextId(draft, 'o'), generator: generatorId, wire, column });
  }
  return normalizeDraft(draft);
}

/** Occupied columns in display order; reading an old draft never rewrites its layout. */
export function getCircuitColumns(operations) {
  return [...new Set(operations.map(operation => operation.column))].sort((a, b) => a - b);
}

function compactSide(operations) {
  const columns = getCircuitColumns(operations);
  const indices = new Map(columns.map((column, index) => [column, index]));
  for (const operation of operations) operation.column = indices.get(operation.column);
  return columns;
}

/** Insert a whole column at a visible gap, optionally moving a gate from either side. */
export function insertGate(value, ruleId, side, generatorId, wire, boundary, source) {
  const draft = normalizeDraft(value);
  const rule = findCircuit(draft, ruleId, side);
  const columns = getCircuitColumns(rule[side]);
  boundary = integer(boundary, 0, columns.length, 'An insertion position');
  const columnAfterGap = columns[boundary] ?? Infinity;
  let operation;
  if (source) {
    const from = findCircuit(draft, source.ruleId, source.side);
    operation = find(from[source.side], source.id, 'gate on this side');
    from[source.side] = from[source.side].filter(item => item.id !== operation.id);
    if (from !== rule || source.side !== side) compactSide(from[source.side]);
  } else operation = { id: nextId(draft, 'o'), generator: generatorId, wire, column: 0 };
  const remainingColumns = compactSide(rule[side]);
  if (remainingColumns.length >= LIMITS.columns) {
    throw new RangeError(`A circuit can contain at most ${LIMITS.columns} columns.`);
  }
  // The gap follows surviving columns, whether the source column emptied or kept parallel gates.
  boundary = remainingColumns.filter(column => column < columnAfterGap).length;
  for (const operation of rule[side]) if (operation.column >= boundary) operation.column++;
  positionGate(operation, generatorId, wire, boundary);
  rule[side].push(operation);
  return normalizeDraft(draft);
}

export function removeGate(value, ruleId, side, operationId) {
  return removeGates(value, ruleId, side, [operationId]);
}

export function removeGates(value, ruleId, side, operationIds) {
  const draft = normalizeDraft(value);
  const rule = findCircuit(draft, ruleId, side);
  const ids = new Set(selectedOperations(rule[side], operationIds).map(operation => operation.id));
  rule[side] = rule[side].filter(operation => !ids.has(operation.id));
  compactSide(rule[side]);
  return draft;
}

function selectedOperations(operations, operationIds) {
  const ids = operationIds === undefined ? null : list(operationIds, LIMITS.gates, 'Selected gates');
  if (!(ids ?? operations).length) throw new RangeError('Choose at least one gate to control.');
  if (ids === null) return operations;
  if (new Set(ids).size !== ids.length) throw new RangeError('Selected gate IDs must be unique.');
  return ids.map(id => find(operations, id, 'gate on this side'));
}

/** Add one outer control to a closed circuit, optionally creating its wire. */
export function controlCircuit(value, ruleId, side, wire, controlValue = 1, operationIds) {
  const draft = normalizeDraft(value);
  if (!supportsControls(draft.structure)) throw new RangeError('This categorical structure does not support controls.');
  const rule = findCircuit(draft, ruleId, side);
  const selected = selectedOperations(rule[side], operationIds);
  const byId = gateMap(draft);
  if (wire === 'above' || wire === 'below') {
    if (wire === 'above') {
      for (const operation of [...rule.left, ...rule.right]) {
        if (byId.get(operation.generator).arity) operation.wire++;
        for (const control of operation.controls ?? []) control.wire++;
      }
    }
    wire = wire === 'above' ? 0 : rule.wires;
    rule.wires++;
  } else wire = integer(wire, 0, rule.wires - 1, 'A control wire');

  const first = Math.min(...selected.map(operation => operation.column));
  const last = Math.max(...selected.map(operation => operation.column));
  const selectedIds = new Set(selected.map(operation => operation.id));
  const bodyTargets = new Set(selected.flatMap(operation => targetWires(operation, byId)));
  const bodyWires = new Set([...bodyTargets, ...selected.flatMap(operation => (operation.controls ?? []).map(control => control.wire))]);
  for (const operation of rule[side]) {
    if (operation.column < first || operation.column > last) continue;
    const targets = targetWires(operation, byId);
    if (targets.includes(wire)) throw new RangeError('The control wire must stay untouched throughout the chosen circuit.');
    if (!selectedIds.has(operation.id) && (targets.some(target => bodyWires.has(target))
      || (operation.controls ?? []).some(control => bodyTargets.has(control.wire)))) {
      throw new RangeError('Choose a closed circuit: an unselected gate touches its wires between the selected gates.');
    }
  }
  for (const operation of selected) operation.controls = [{ wire, value: controlValue }, ...(operation.controls ?? [])];
  return normalizeDraft(draft);
}

export function removeControls(value, ruleId, side, operationIds) {
  const draft = normalizeDraft(value);
  const rule = findCircuit(draft, ruleId, side);
  for (const operation of selectedOperations(rule[side], operationIds)) delete operation.controls;
  return draft;
}

/** Grid layout disappears on export: each gate names its consecutive wire slice. */
export function exportTheory(value) {
  const draft = normalizeDraft(value);
  if (draft.structure !== 'PRO' && draft.structure !== 'PROP') throw new RangeError('Search currently supports PRO and PROP theories only.');
  if (!draft.generators.length && draft.structure === 'PRO') throw new RangeError('Add at least one generator.');
  if (!draft.rules.length) throw new RangeError('Add at least one equation.');
  const byId = gateMap(draft);
  const definitions = new Map((draft.shortcuts ?? []).map(shortcut => [shortcut.id, shortcut]));
  const expanded = new Map();
  const expand = operations => {
    const result = [];
    for (const operation of [...operations].sort((a, b) => a.column - b.column || a.wire - b.wire || a.id.localeCompare(b.id, 'en'))) {
      const definition = definitions.get(operation.generator);
      if (definition && !expanded.has(definition.id)) expanded.set(definition.id, expand(definition.left));
      const body = expanded.get(operation.generator);
      if (result.length + (body?.length ?? 1) > LIMITS.expandedGates) throw new RangeError(`After expanding shortcuts, each equation side can contain at most ${LIMITS.expandedGates} gates.`);
      if (body) {
        for (const inner of body) result.push({ generator: inner.generator,
          wire: byId.get(inner.generator).arity ? operation.wire + inner.wire : 0 });
      } else result.push(operation);
    }
    return result;
  };
  const term = (operations, wires) => ({
    wires,
    ops: expand(operations).map(operation => {
      const generator = byId.get(operation.generator);
      if (generator.kind === 'swap') {
        const perm = Array.from({ length: wires }, (_, index) => index);
        [perm[operation.wire], perm[operation.wire + 1]] = [perm[operation.wire + 1], perm[operation.wire]];
        return { perm };
      }
      return { gen: generator.name, on: targetWires(operation, byId) };
    }),
  });
  return {
    ...(draft.structure === 'PROP' ? { structure: 'PROP' } : {}),
    name: draft.name,
    generators: Object.fromEntries(draft.generators.map(generator => [generator.name, { type: generator.arity }])),
    equations: draft.rules.map(rule => ({ id: rule.name, lhs: term(rule.left, rule.wires), rhs: term(rule.right, rule.wires) })),
  };
}

export function serializeDraft(value) {
  const draft = normalizeDraft(value);
  const operation = entry => [entry.id, entry.generator, entry.wire, entry.column,
    ...(entry.controls ? [entry.controls.map(control => [control.wire, control.value])] : [])];
  const circuit = entry => {
    const sides = [entry.left.map(operation), entry.right.map(operation)];
    while (sides.length && !sides.at(-1).length) sides.pop();
    return [entry.id, entry.name, entry.wires, ...sides];
  };
  const source = JSON.stringify({
    version: 2, name: draft.name,
    ...(draft.structure === 'PRO' ? {} : { structure: draft.structure }),
    ...(draft.controlValues === 2 ? {} : { controlValues: draft.controlValues }),
    generators: draft.generators.map(entry => [entry.id, entry.name, entry.arity]),
    rules: draft.rules.map(circuit),
    ...(draft.shortcuts?.length ? { shortcuts: draft.shortcuts.map(circuit) } : {}),
  });
  if (new TextEncoder().encode(source).byteLength > LIMITS.bytes) throw new RangeError('The draft must fit within 256 KB.');
  return source;
}

export function parseDraft(source) {
  return normalizeDraft(parseJSON(source, LIMITS.bytes, 'The draft'));
}
