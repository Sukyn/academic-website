import { LIMITS, createTheory, normalizeDraft, exportTheory } from './model.js';
import { integer, list, gateLabel, parseJSON } from './validation.js';
import { displayName } from './format.js';

const MAX_EXPANSION = 10_000;
const MAX_DEPTH = 64;
const wireIndices = count => Array.from({ length: count }, (_, index) => index);
const mapWires = (operations, map) => operations.map(operation => ({ ...operation, on: operation.on.map(map) }));

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new RangeError(`${label} must be an object.`);
  }
  if (allowed && Object.keys(value).some(key => !allowed.includes(key))) {
    throw new RangeError(`${label} contains unsupported fields.`);
  }
  return value;
}

/** A permutation lists the input wire arriving at each output position. */
function permutationSwaps(order) {
  list(order, LIMITS.wires, 'A permutation');
  const current = wireIndices(order.length);
  if (new Set(order).size !== order.length || [...order].some(wire => !Number.isInteger(wire) || wire < 0 || wire >= order.length)) {
    throw new RangeError('A permutation must contain every wire index exactly once.');
  }
  const operations = [];
  for (let position = 0; position < order.length; position++) {
    let index = current.indexOf(order[position]);
    while (index > position) {
      [current[index - 1], current[index]] = [current[index], current[index - 1]];
      operations.push({ generator: '$swap', on: [index - 1, index] });
      index--;
    }
  }
  return operations;
}

/** Import syntax only: matrices, wire dimension, and source annotations are not editor state. */
export function importTheory(value) {
  object(value, ['name', 'wire_dimension', 'source', 'generators', 'macros', 'equations'], 'The theory');
  const rawGenerators = object(value.generators, null, 'Generators');
  if (Object.keys(rawGenerators).length > LIMITS.generators) throw new RangeError(`The editor supports at most ${LIMITS.generators} generators.`);
  const generators = Object.entries(rawGenerators).map(([name, definition], index) => {
    let arity = definition;
    if (definition && typeof definition === 'object' && !Array.isArray(definition)) {
      object(definition, ['type', 'matrix'], 'A generator');
      arity = definition.type;
    }
    if (!Number.isInteger(arity)) throw new RangeError('Only generators with fixed endomorphic arities are supported.');
    return { id: `g${index + 1}`, name, arity: integer(arity, 0, LIMITS.wires, 'A generator arity') };
  });
  const byName = new Map(generators.map(generator => [generator.name, generator]));
  const macros = object(Object.hasOwn(value, 'macros') ? value.macros : {}, null, 'Macros');
  if (Object.keys(macros).length > 128) throw new RangeError('A theory can contain at most 128 macros.');
  const definitions = new Map(Object.entries(macros)), resolved = new Map(), visiting = new Set(), shortcuts = new Map();
  let work = 0;
  function append(operations, additions) {
    work += additions.length;
    if (work > MAX_EXPANSION || operations.length + additions.length > MAX_EXPANSION) {
      throw new RangeError('The theory exceeds the bounded circuit expansion limit.');
    }
    operations.push(...additions);
  }
  function macro(name, depth) {
    if (resolved.has(name)) return resolved.get(name);
    if (!definitions.has(name)) throw new RangeError('Every macro reference must name a defined macro.');
    if (visiting.has(name)) throw new RangeError('Macro definitions cannot contain a cycle.');
    visiting.add(name);
    const circuit = parse(definitions.get(name), depth + 1);
    visiting.delete(name);
    resolved.set(name, circuit);
    return circuit;
  }
  function parse(term, depth = 0, preserve = false) {
    if (depth > MAX_DEPTH) throw new RangeError('Circuit nesting exceeds the supported depth.');
    if (++work > MAX_EXPANSION) throw new RangeError('The theory exceeds the bounded circuit expansion limit.');
    object(term, null, 'A circuit');
    if (Object.hasOwn(term, 'wires') || Object.hasOwn(term, 'ops')) {
      object(term, ['wires', 'ops'], 'A compact circuit');
      const wires = integer(term.wires, 0, LIMITS.wires, 'A circuit wire count');
      const operations = [];
      for (const operation of list(term.ops, MAX_EXPANSION, 'Circuit operations')) {
        const { on, ...expression } = object(operation, ['gen', 'macro', 'perm', 'on', 'repeat'], 'A circuit operation');
        const body = parse(expression, depth + 1, preserve);
        let selected;
        if (Object.hasOwn(expression, 'perm')) {
          if (Object.hasOwn(operation, 'on')) throw new RangeError('A permutation cannot have an on placement.');
          if (body.wires !== wires) throw new RangeError('A permutation must use the whole circuit register.');
          selected = wireIndices(wires);
        } else if (!Object.hasOwn(operation, 'on')) {
          if (body.wires !== 0 && body.wires !== wires) throw new RangeError('A partial-register operation needs an explicit on placement.');
          selected = wireIndices(body.wires);
        } else if (Number.isInteger(on)) {
          if (body.wires !== 1) throw new RangeError('Only a unary operation can use a single on index.');
          selected = [on];
        } else selected = list(on, LIMITS.wires, 'An operation placement');
        if (selected.length !== body.wires || new Set(selected).size !== selected.length) throw new RangeError('An operation must select its distinct input wires in order.');
        for (const wire of selected) integer(wire, 0, wires - 1, 'An operation wire');
        append(operations, mapWires(body.operations, wire => selected[wire]));
      }
      return { wires, operations };
    }
    const kinds = ['gen', 'macro', 'id', 'perm', 'compose', 'tensor'].filter(key => Object.hasOwn(term, key));
    if (kinds.length !== 1) throw new RangeError('A circuit needs exactly one gen, macro, id, perm, compose, or tensor form.');
    const kind = kinds[0], repeatable = ['gen', 'macro', 'perm'].includes(kind);
    object(term, repeatable ? [kind, 'repeat'] : [kind], 'A circuit');
    let result;
    if (kind === 'gen') {
      const generator = byName.get(term.gen);
      if (!generator) throw new RangeError('Every gate must name a generator in this theory.');
      result = { wires: generator.arity, operations: [{ generator: generator.id, on: wireIndices(generator.arity) }] };
    } else if (kind === 'macro') {
      result = macro(term.macro, depth);
      const shortcut = preserve && shortcuts.get(term.macro);
      if (shortcut) result = { wires: result.wires, operations: [{ generator: shortcut.id, on: wireIndices(result.wires) }] };
    } else if (kind === 'id') result = { wires: integer(term.id, 0, LIMITS.wires, 'An identity wire count'), operations: [] };
    else if (kind === 'perm') result = { wires: term.perm?.length, operations: permutationSwaps(term.perm) };
    else {
      const parts = list(term[kind], MAX_EXPANSION, `A ${kind}`), operations = [];
      if (kind === 'compose' && !parts.length) throw new RangeError('An empty composition has no wire count.');
      let wires = kind === 'compose' ? undefined : 0;
      for (const part of parts) {
        const circuit = parse(part, depth + 1, preserve);
        if (kind === 'compose') {
          if (wires !== undefined && wires !== circuit.wires) throw new RangeError('Composed circuits must have matching wire counts.');
          wires = circuit.wires;
          append(operations, circuit.operations);
        } else {
          append(operations, mapWires(circuit.operations, wire => wire + wires));
          wires = integer(wires + circuit.wires, 0, LIMITS.wires, 'A tensor wire count');
        }
      }
      result = { wires, operations };
    }
    if (repeatable) {
      const repeat = integer(Object.hasOwn(term, 'repeat') ? term.repeat : 1, 1, MAX_EXPANSION, 'An operation repeat');
      const operations = [];
      for (let index = 0; index < repeat; index++) append(operations, result.operations);
      result = { ...result, operations };
    }
    return result;
  }

  // Validate unused macro bodies too, so unsupported syntax is never silently dropped.
  for (const name of definitions.keys()) macro(name, 0);
  let operationIndex = 1;
  function side(circuit) {
    const routed = [];
    let routingWork = 0;
    function emit(operation) {
      if (++routingWork > MAX_EXPANSION) throw new RangeError('The theory exceeds the bounded routing expansion limit.');
      const previous = routed.at(-1);
      if (operation.generator === '$swap' && previous?.generator === '$swap' && operation.on[0] === previous.on[0]) routed.pop();
      else routed.push(operation);
    }
    for (const operation of circuit.operations) {
      const selected = operation.generator === '$swap' ? operation.on.toSorted((a, b) => a - b) : operation.on;
      const anchor = selected.length ? Math.min(...selected) : 0;
      if (selected.every((wire, index) => wire === anchor + index)) {
        emit({ generator: operation.generator, on: selected });
        continue;
      }
      const order = wireIndices(circuit.wires).filter(wire => !selected.includes(wire));
      order.splice(anchor, 0, ...selected);
      const routing = permutationSwaps(order);
      for (const swap of routing) emit(swap);
      emit({ generator: operation.generator, on: selected.map((_, index) => anchor + index) });
      for (const swap of routing.toReversed()) emit(swap);
    }
    if (routed.length > LIMITS.gates) throw new RangeError(`An expanded circuit exceeds the editor's ${LIMITS.gates}-gate limit.`);
    const nextColumn = Array(circuit.wires).fill(0);
    let scalarColumn = 0;
    return routed.map(operation => {
      const column = operation.on.length ? Math.max(...operation.on.map(wire => nextColumn[wire])) : scalarColumn++;
      if (column >= LIMITS.columns) throw new RangeError(`An expanded circuit exceeds the editor's ${LIMITS.columns}-column limit.`);
      for (const wire of operation.on) nextColumn[wire] = column + 1;
      return { id: `o${operationIndex++}`, generator: operation.generator, wire: operation.on[0] ?? 0, column };
    });
  }
  const base = normalizeDraft({ ...createTheory(), name: value.name ?? 'Imported theory', structure: 'PROP', generators });
  const names = new Set(base.generators.map(generator => displayName(generator.name)));
  const parsedWork = work;
  for (const name of definitions.keys()) {
    if (shortcuts.size >= LIMITS.shortcuts) break;
    try {
      const { name: label, display: visible } = gateLabel(name, 'A shortcut name', LIMITS.shortcutName, true);
      if (names.has(visible)) continue;
      work = parsedWork;
      const circuit = parse(definitions.get(name), 0, true);
      shortcuts.set(name, { id: `s${shortcuts.size + 1}`, name: label, wires: circuit.wires, left: side(circuit), right: [] });
      names.add(visible);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // Keep importing aliases that cannot be named or drawn as editor shortcuts.
    }
  }
  function build(preserve) {
    operationIndex = 1;
    work = parsedWork;
    const savedShortcuts = preserve ? [...shortcuts].map(([name, shortcut]) => ({ ...shortcut,
      left: side(parse(definitions.get(name), 0, true)) })) : [];
    const rules = list(value.equations, LIMITS.rules, 'Equations').map((equation, index) => {
      object(equation, ['id', 'lhs', 'rhs'], 'An equation');
      const left = parse(equation.lhs, 0, preserve), right = parse(equation.rhs, 0, preserve);
      if (left.wires !== right.wires) throw new RangeError('Both sides of an equation must have the same wire count.');
      return { id: `r${index + 1}`, name: equation.id, wires: left.wires, left: side(left), right: side(right) };
    });
    const draft = normalizeDraft({ ...base, rules, ...(savedShortcuts.length ? { shortcuts: savedShortcuts } : {}) });
    if (savedShortcuts.length && rules.length) exportTheory(draft);
    return draft;
  }
  if (!shortcuts.size) return build(false);
  try { return build(true); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return build(false);
  }
}

/** Open either an editor save or an upstream JSON presentation. */
export function parseTheoryFile(source) {
  const value = parseJSON(source, LIMITS.bytes, 'The file');
  return value && typeof value === 'object' && Object.hasOwn(value, 'version') ? normalizeDraft(value) : importTheory(value);
}
