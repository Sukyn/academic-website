import { GATES, validatePuzzle } from './engine.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z][\w-]{0,39}$/.test(value);
const bounded = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const compatible = (gate, wires) => GATES.includes(gate) && (gate === 'I' || (gate.length === 2 ? 2 : 1) === wires.length);
const reversedGate = gate => gate === 'CX' ? 'XC' : gate === 'XC' ? 'CX' : gate;
const endpoint = value => value === 'control' || value === 'target' || value === 'phase' || value === 'hole';
const isControl = role => role === 'control' || role === 'phase';

function copyEntry(entry, wireCount) {
  if (!object(entry) || !Array.isArray(entry.wires) || !bounded(entry.wires.length, 1, 2) ||
      Array.from(entry.wires).some(wire => !bounded(wire, 0, wireCount - 1)) || new Set(entry.wires).size !== entry.wires.length) {
    throw new RangeError('Choose one or two distinct wires.');
  }
  const reversed = entry.wires.length === 2 && entry.wires[0] > entry.wires[1];
  const wires = [...entry.wires].sort((first, second) => first - second);
  const gate = value => reversed ? reversedGate(value) : value;
  if (Object.hasOwn(entry, 'endpoint')) {
    if (wires.length !== 1 || !endpoint(entry.endpoint)) throw new RangeError('Choose a gate or hole endpoint.');
    return { endpoint: entry.endpoint, wires };
  }
  if (Object.hasOwn(entry, 'choices') || Object.hasOwn(entry, 'id')) {
    if (!Array.isArray(entry.choices) || entry.choices.length > 4 || new Set(entry.choices).size !== entry.choices.length ||
        Array.from(entry.choices).some(choice => !compatible(choice, wires)) ||
        (Object.hasOwn(entry, 'id') && !identifier(entry.id))) throw new RangeError('Choose compatible gates for this hole.');
    return { ...(Object.hasOwn(entry, 'id') ? { id: entry.id } : {}), wires, choices: entry.choices.map(gate) };
  }
  if (!compatible(entry.gate, wires)) throw new RangeError('Choose a gate for these wires.');
  return { gate: gate(entry.gate), wires };
}

function copyDraft(draft) {
  if (!object(draft) || !bounded(draft.wires, 1, 4) ||
      !Array.isArray(draft.columns) || !bounded(draft.columns.length, 1, 16)) throw new RangeError('Use 1–4 wires and 1–16 columns.');
  const ids = new Set();
  const columns = Array.from(draft.columns, column => {
    if (!Array.isArray(column) || column.length > draft.wires) throw new RangeError('Invalid circuit column.');
    const occupied = new Set();
    return Array.from(column, entry => {
      const copy = copyEntry(entry, draft.wires);
      if (copy.wires.some(wire => occupied.has(wire))) throw new RangeError('Each gate needs available wires.');
      copy.wires.forEach(wire => occupied.add(wire));
      if (copy.choices) {
        if (!identifier(copy.id) || ids.has(copy.id)) throw new RangeError('Invalid circuit hole.');
        ids.add(copy.id);
      }
      return copy;
    });
  });
  if (ids.size > 6) throw new RangeError('Use at most six holes.');
  return { wires: draft.wires, columns };
}

export function draftFromPuzzle(input) {
  const puzzle = validatePuzzle(input);
  return copyDraft({ wires: puzzle.wires, columns: puzzle.columns });
}

export function resizeDraft(draft, options = {}) {
  const copy = copyDraft(draft);
  if (!object(options)) throw new RangeError('Choose a wire and column count.');
  const { wires = copy.wires, columns = copy.columns.length } = options;
  if (!bounded(wires, 1, 4) || !bounded(columns, 1, 16)) throw new RangeError('Use 1–4 wires and 1–16 columns.');
  copy.columns = Array.from({ length: columns }, (_, index) =>
    (copy.columns[index] ?? []).filter(entry => entry.wires.every(wire => wire < wires)));
  copy.wires = wires;
  return copy;
}

// Both edit paths copy and validate once before replacing whole paired entries.
// Gates on unconnected intermediate wires stay intact.
function replaceEntry(copy, column, entry, selectedWire) {
  const previous = copy.columns[column].find(entry => entry.wires.includes(selectedWire));
  copy.columns[column] = copy.columns[column].filter(current => !current.wires.includes(selectedWire) &&
    !entry?.wires.some(wire => current.wires.includes(wire)));
  if (entry) {
    if (entry.choices) {
      const ids = new Set(copy.columns.flat().filter(current => current.choices).map(current => current.id));
      entry.id ??= previous?.id;
      if (!entry.id) {
        let suffix = 1;
        while (ids.has('h' + suffix)) suffix++;
        entry.id = 'h' + suffix;
      }
      if (ids.has(entry.id)) throw new RangeError('Invalid circuit hole.');
      if (ids.size >= 6) throw new RangeError('Use at most six holes.');
    }
    copy.columns[column].push(entry);
  }
  return copy;
}

export function setDraftEntry(draft, column, entryOrNull, selectedWire) {
  const copy = copyDraft(draft);
  if (!bounded(column, 0, copy.columns.length - 1) || !bounded(selectedWire, 0, copy.wires - 1)) {
    throw new RangeError('Choose a circuit cell.');
  }
  return replaceEntry(copy, column, entryOrNull === null ? null : copyEntry(entryOrNull, copy.wires), selectedWire);
}

export function connectDraftEntry(draft, column, fromWire, toWire, otherEndpoint) {
  const copy = copyDraft(draft);
  if (!bounded(column, 0, copy.columns.length - 1) || !bounded(fromWire, 0, copy.wires - 1) ||
      !bounded(toWire, 0, copy.wires - 1) || fromWire === toWire) throw new RangeError('Choose two distinct wires in the same column.');
  const source = copy.columns[column].find(entry => entry.wires.includes(fromWire));
  const destination = copy.columns[column].find(entry => entry.wires.includes(toWire));
  const first = source?.endpoint;
  const second = otherEndpoint ?? destination?.endpoint ?? (first === 'control' ? 'target' : first === 'target' ? 'control' : first);
  if (!endpoint(first) || !endpoint(second)) throw new RangeError('Choose an unconnected gate or hole endpoint.');
  const wires = [Math.min(fromWire, toWire), Math.max(fromWire, toWire)];
  let entry;
  if (first === 'hole' && second === 'hole') entry = { wires, choices: ['I', 'CX', 'XC', 'CZ'] };
  else if (isControl(first) && isControl(second)) entry = { gate: 'CZ', wires };
  else if ((isControl(first) && second === 'target') || (first === 'target' && isControl(second))) {
    const control = isControl(first) ? fromWire : toWire;
    entry = { gate: control === wires[0] ? 'CX' : 'XC', wires };
  } else throw new RangeError('Connect compatible gate or hole endpoints.');
  return replaceEntry(copy, column, entry, fromWire);
}

export function puzzleFromDraft(draft) {
  const copy = copyDraft(draft);
  if (copy.columns.some(column => column.some(entry => entry.endpoint))) throw new RangeError('Connect or remove every unconnected endpoint before playing.');
  return validatePuzzle({ wires: copy.wires, columns: copy.columns });
}
