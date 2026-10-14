// Reversible rules from the outreach PDF, its solved missions, and the Unity game.
// Rows are wires, columns are freely adjustable identity slots.
export const EMPTY = '.';
// Width is a layout choice, not a limit on the paper circuit. Replay/API callers
// impose their own resource budgets before allocating user-supplied layouts.
export const MAX_WIRES = 4;
export const RULES = Object.freeze([
  { id: 'slide-h', title: 'Move H', left: [['.', 'H']], right: [['H', '.']], description: 'Move H into a neighbouring empty slot.' },
  { id: 'slide-x', title: 'Move X', left: [['.', 'X']], right: [['X', '.']], description: 'Move X into a neighbouring empty slot.' },
  { id: 'cancel-h', title: 'Cancel HH', left: [['H', 'H']], right: [['.', '.']], description: 'Two consecutive H gates cancel.' },
  { id: 'cancel-x', title: 'Cancel XX', left: [['X', 'X']], right: [['.', '.']], description: 'Two consecutive X gates cancel.' },
  { id: 'cancel-z', derived: true, title: 'Cancel ZZ', left: [['Z', 'Z']], right: [['.', '.']], description: 'A learned shortcut: two consecutive Z phases cancel.' },
  { id: 'cancel-cz', derived: true, title: 'Cancel CZ pair', left: [['ZU', 'ZU'], ['ZD', 'ZD']], right: [['.', '.'], ['.', '.']], description: 'A learned shortcut: two consecutive controlled Z gates cancel.' },
  { id: 'basis-x', title: 'Change basis · X', left: [['H', 'Z', 'H']], right: [['.', 'X', '.']], description: 'HZH and X have the same effect.' },
  { id: 'basis-z', derived: true, title: 'Change basis · Z', left: [['H', 'X', 'H']], right: [['.', 'Z', '.']], description: 'A learned shortcut: HXH and Z have the same effect.' },
  { id: 'basis-up', title: 'Change basis · upper', left: [['H', 'ZU', 'H']], right: [['.', 'XU', '.']], description: 'H on either side turns the upper Z endpoint into X.' },
  { id: 'basis-down', title: 'Change basis · lower', left: [['H', 'ZD', 'H']], right: [['.', 'XD', '.']], description: 'H on either side turns the lower Z endpoint into X.' },
  // The printed rules use CNOT cancellation, while Unity uses CZ cancellation.
  // Keep both valid versions, rather than silently losing either source's rule.
  { id: 'cancel-cnot-down', title: 'Cancel CNOT ↓ pair', left: [['ZU', 'ZU'], ['XD', 'XD']], right: [['.', '.'], ['.', '.']], description: 'Two CNOT gates with the same lower target cancel.' },
  { id: 'cancel-cnot-up', derived: true, title: 'Cancel CNOT ↑ pair', left: [['XU', 'XU'], ['ZD', 'ZD']], right: [['.', '.'], ['.', '.']], description: 'A learned shortcut: two CNOT gates with the same upper target cancel.' },
  { id: 'phase-up', advanced: true, title: 'Move upper phase', left: [['Z', 'ZU', '.']], right: [['.', 'ZU', 'Z']], description: 'A Z phase commutes with a Z control.' },
  { id: 'phase-down', advanced: true, title: 'Move lower phase', left: [['Z', 'ZD', '.']], right: [['.', 'ZD', 'Z']], description: 'A Z phase commutes with a Z control.' },
  { id: 'control-order', advanced: true, title: 'Reorder controls', left: [['.', 'ZU'], ['ZU', 'ZD'], ['ZD', '.']], right: [['ZU', '.'], ['ZD', 'ZU'], ['.', 'ZD']], description: 'Overlapping controlled Z gates commute.' },
  { id: 'stabilizer-up', advanced: true, title: 'Propagate upper X', left: [['X', 'ZU'], ['.', 'ZD']], right: [['ZU', 'X'], ['ZD', 'Z']], description: 'Moving X through CZ adds a Z on the other wire.' },
  { id: 'stabilizer-down', advanced: true, title: 'Propagate lower X', left: [['.', 'ZU'], ['X', 'ZD']], right: [['ZU', 'Z'], ['ZD', 'X']], description: 'Moving X through CZ adds a Z on the other wire.' },
  { id: 'transfer', advanced: true, title: 'Transfer', left: [['ZU', 'XU', 'ZU'], ['XD', 'ZD', 'XD']], right: [['XU', 'ZU', 'XU'], ['ZD', 'XD', 'ZD']], description: 'Reverse the directions of an alternating three-CNOT block.' },
  { id: 'corner-down', advanced: true, title: 'Change lower corner', left: [['ZU', 'ZU', '.'], ['XD', 'ZD', '.']], right: [['ZU', 'ZU', 'Z'], ['ZD', 'XD', '.']], description: 'Swap CNOT and CZ while introducing the corresponding phase.' },
  { id: 'corner-up', advanced: true, title: 'Change upper corner', left: [['XU', 'ZU', '.'], ['ZD', 'ZD', '.']], right: [['ZU', 'XU', '.'], ['ZD', 'ZD', 'Z']], description: 'Swap CNOT and CZ while introducing the corresponding phase.' },
]);
export const PAPER_RULE_IDS = Object.freeze(RULES.filter(rule => !rule.derived).map(rule => rule.id));
export const LEARNED_RULE_IDS = Object.freeze(RULES.map(rule => rule.id));
const symbols = new Set(['.', 'H', 'X', 'Z', 'ZU', 'ZD', 'XU', 'XD']);
export const cloneCircuit = circuit => circuit.map(row => [...row]);
export const isSolved = circuit => circuit.every(row => row.every(cell => cell === EMPTY));
export const circuitKey = circuit => circuit.map(row => row.join(',')).join(';');
export const moveCost = move => ['slide-h', 'slide-x', 'insert-column', 'remove-column', 'insert-space', 'remove-space', 'compact-identities', 'arrange'].includes(move?.rule) ? 0 : 1;
export const sequenceCost = sequence => sequence.reduce((total, move) => total + moveCost(move), 0);

function gateCounts(circuit) {
  let singles = 0, linked = 0;
  for (const row of circuit) for (const cell of row) {
    if (cell.length === 1 && cell !== EMPTY) singles++;
    else if (cell.endsWith('U')) linked++;
  }
  return { singles, linked };
}

// The solver visits many circuits, but the rule patterns never change.
const rewriteRules = RULES.filter(rule => moveCost({ rule: rule.id })).map(rule => ({
  id: rule.id,
  patterns: [rule.left, rule.right].map(pattern => ({
    pattern, width: pattern[0].length,
    from: gateCounts(pattern), to: gateCounts(pattern === rule.left ? rule.right : rule.left),
    expectedRows: pattern.map(line => line.map((symbol, x) => ({ symbol, x })).filter(cell => cell.symbol !== EMPTY)),
  })),
}));

// A linked gate is one node shared by its two wires. Edges retain the order of
// gates on each wire; operations on disjoint wires can move independently.
function circuitGraph(circuit) {
  const nodes = [], wires = circuit.map(() => []);
  for (let column = 0; column < circuit[0].length; column++) for (let row = 0; row < circuit.length; row++) {
    const symbol = circuit[row][column];
    if (symbol === EMPTY || symbol.endsWith('D')) continue;
    const cells = [{ row, symbol }];
    if (symbol.endsWith('U')) cells.push({ row: row + 1, symbol: circuit[row + 1][column] });
    const node = { id: nodes.length, column, cells };
    nodes.push(node);
    for (const cell of cells) wires[cell.row].push(node.id);
  }
  return { nodes, wires };
}

function drawGraph(graph, columns, minimumWidth = 2) {
  const width = Math.max(minimumWidth, ...columns.map(column => column + 1));
  const circuit = graph.wires.map(() => Array(width).fill(EMPTY));
  graph.nodes.forEach(node => node.cells.forEach(({ row, symbol }) => { circuit[row][columns[node.id]] = symbol; }));
  return circuit;
}

export function compactCircuit(circuit) {
  validateCircuit(circuit);
  const graph = circuitGraph(circuit), last = circuit.map(() => -1), columns = [];
  for (const node of graph.nodes) {
    const column = Math.max(...node.cells.map(({ row }) => last[row] + 1));
    columns[node.id] = column;
    for (const { row } of node.cells) last[row] = column;
  }
  return drawGraph(graph, columns);
}

export function insertWireSpace(circuit, row, column, count = 1) {
  validateCircuit(circuit);
  if (!Number.isInteger(row) || row < 0 || row >= circuit.length || !Number.isInteger(column) || column < 0 || column > circuit[0].length || !Number.isSafeInteger(count) || count < 1) throw new RangeError('Choose a wire, a space boundary, and a positive whole-number space count.');
  const graph = circuitGraph(circuit), last = circuit.map(() => -1), columns = [];
  for (const node of graph.nodes) {
    const selected = node.column >= column && node.cells.some(cell => cell.row === row);
    const nextColumn = Math.max(node.column + (selected ? count : 0), ...node.cells.map(cell => last[cell.row] + 1));
    columns[node.id] = nextColumn;
    for (const cell of node.cells) last[cell.row] = nextColumn;
  }
  return drawGraph(graph, columns, circuit[0].length + count);
}

export function removeWireSpace(circuit, row, column) {
  validateCircuit(circuit);
  if (!Number.isInteger(row) || row < 0 || row >= circuit.length || !Number.isInteger(column) || column < 0 || column >= circuit[0].length || circuit[row][column] !== EMPTY) throw new RangeError('Choose an empty slot.');
  const graph = circuitGraph(circuit);
  const columns = graph.nodes.map(node => node.column - (node.column > column && node.cells.some(cell => cell.row === row) ? 1 : 0));
  const predecessors = graph.nodes.map(() => []);
  for (const wire of graph.wires) for (let index = 1; index < wire.length; index++) predecessors[wire[index]].push(wire[index - 1]);
  // Pull preceding gates on a linked endpoint's other wire only when needed.
  // Reverse column order makes every successor constraint available first.
  for (let index = graph.nodes.length - 1; index >= 0; index--) {
    if (columns[index] < 0) throw new RangeError('This space is needed for alignment.');
    for (const previous of predecessors[index]) columns[previous] = Math.min(columns[previous], columns[index] - 1);
  }
  const next = drawGraph(graph, columns, Math.max(2, circuit[0].length - 1));
  if (circuitKey(next) === circuitKey(circuit)) throw new RangeError('This space is needed for alignment.');
  return next;
}

export function validateCircuit(circuit) {
  if (!Array.isArray(circuit) || circuit.length < 1 || circuit.length > MAX_WIRES ||
      !Array.isArray(circuit[0]) || circuit[0].length < 2) {
    throw new RangeError(`Use 1–${MAX_WIRES} wires and at least two columns.`);
  }
  const width = circuit[0].length;
  for (let row = 0; row < circuit.length; row++) {
    if (!Array.isArray(circuit[row]) || circuit[row].length !== width || circuit[row].some(cell => !symbols.has(cell))) {
      throw new RangeError('Use equally long rows containing . H X Z ZU ZD XU XD.');
    }
    for (let column = 0; column < width; column++) {
      const cell = circuit[row][column];
      if (cell.endsWith('U') && !['ZD', 'XD'].includes(circuit[row + 1]?.[column])) throw new RangeError('Each upper endpoint needs a lower endpoint directly below it.');
      if (cell.endsWith('D') && !['ZU', 'XU'].includes(circuit[row - 1]?.[column])) throw new RangeError('Each lower endpoint needs an upper endpoint directly above it.');
    }
  }
  return circuit;
}

function matches(circuit, pattern, row, column) {
  return pattern.every((line, y) => line.every((cell, x) => circuit[row + y]?.[column + x] === cell));
}

export function getLegalMoves(circuit, { allowedRules, window } = {}) {
  const moves = [];
  for (const rule of RULES) {
    if (allowedRules && !allowedRules.includes(rule.id)) continue;
    if (window && (rule.left.length !== window.height || rule.left[0].length !== window.width)) continue;
    const lastRow = window?.row ?? circuit.length - rule.left.length;
    const lastColumn = window?.column ?? circuit[0].length - rule.left[0].length;
    for (let row = window?.row ?? 0; row <= lastRow; row++) {
      for (let column = window?.column ?? 0; column <= lastColumn; column++) {
        if (matches(circuit, rule.left, row, column) || matches(circuit, rule.right, row, column)) moves.push({ rule: rule.id, row, column });
      }
    }
  }
  return moves;
}

export function applyMove(circuit, move) {
  if (!move || typeof move !== 'object' || !Number.isInteger(move.row) || !Number.isInteger(move.column) || move.row < 0 || move.column < 0) throw new RangeError('Choose a valid rule window.');
  const { row, column } = move;
  if (move.rule === 'insert-space') return insertWireSpace(circuit, row, column, move.count ?? 1);
  if (move.rule === 'remove-space') return removeWireSpace(circuit, row, column);
  if (move.rule === 'compact-identities') return compactCircuit(circuit);
  if (move.rule === 'arrange') {
    validateCircuit(move.circuit);
    if (circuitKey(compactCircuit(circuit)) !== circuitKey(compactCircuit(move.circuit))) throw new RangeError('Space adjustments must preserve every gate and the order on each wire.');
    return cloneCircuit(move.circuit);
  }
  const next = cloneCircuit(circuit);
  if (move.rule === 'insert-column') {
    if (row !== 0 || column > circuit[0].length) throw new RangeError('Cannot insert a column here.');
    const count = move.count ?? 1;
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Choose a positive whole-number space count.');
    next.forEach((line, index) => { next[index] = [...line.slice(0, column), ...Array(count).fill(EMPTY), ...line.slice(column)]; });
  } else if (move.rule === 'remove-column') {
    if (row !== 0 || column >= circuit[0].length || circuit[0].length <= 2 || !circuit.every(line => line[column] === EMPTY)) throw new RangeError('Only a completely empty column can be removed.');
    next.forEach(line => line.splice(column, 1));
  } else {
    const rule = RULES.find(item => item.id === move.rule);
    if (!rule) throw new RangeError('Unknown circuit rule.');
    const pattern = matches(circuit, rule.left, row, column) ? rule.right : matches(circuit, rule.right, row, column) ? rule.left : null;
    if (!pattern) throw new RangeError('Select every cell in a matching rule window, including empty cells.');
    pattern.forEach((line, y) => line.forEach((cell, x) => { next[row + y][column + x] = cell; }));
  }
  return next;
}

// Match consecutive gates on each wire, then solve the layout constraints for
// the rule's empty cells. This enumerates rewrites modulo freely inserted paper
// identities rather than charging artificial steps for horizontal alignment.
export function getRewriteMoves(circuit, { allowedRules, maxLowerBound = Infinity } = {}) {
  validateCircuit(circuit);
  const graph = circuitGraph(circuit), results = new Map();
  const sourceKey = circuitKey(compactCircuit(circuit));
  const token = (id, row) => graph.nodes[id].cells.find(cell => cell.row === row)?.symbol;
  const initial = gateCounts(circuit);
  for (const rule of rewriteRules) {
    if (allowedRules && !allowedRules.includes(rule.id)) continue;
    for (const { pattern, width, from, to, expectedRows } of rule.patterns) {
      const predictedBound = Math.ceil((initial.singles - from.singles + to.singles) / 2) + Math.ceil((initial.linked - from.linked + to.linked) / 2);
      if (predictedBound > maxLowerBound) continue;
      for (let row = 0; row <= circuit.length - pattern.length; row++) {
        const choices = expectedRows.map((expected, y) => {
          const wire = graph.wires[row + y], matches = [];
          for (let start = 0; start <= wire.length - expected.length; start++) {
            if (expected.every((cell, offset) => token(wire[start + offset], row + y) === cell.symbol)) matches.push({ start, expected });
          }
          return matches;
        });
        if (choices.some(list => !list.length)) continue;
        const selected = [];
        function visit(y) {
          if (y < choices.length) {
            for (const choice of choices[y]) { selected[y] = choice; visit(y + 1); }
            return;
          }
          const offsets = new Map();
          for (let dy = 0; dy < pattern.length; dy++) {
            const { start, expected } = selected[dy], wire = graph.wires[row + dy];
            for (let x = 0; x < expected.length; x++) {
              const id = wire[start + x], offset = expected[x].x;
              if (offsets.has(id) && offsets.get(id) !== offset) return;
              offsets.set(id, offset);
            }
          }
          const group = id => offsets.has(id) ? 0 : id + 1;
          const offset = id => offsets.get(id) ?? 0;
          const edges = [];
          for (const wire of graph.wires) for (let i = 1; i < wire.length; i++) {
            const a = wire[i - 1], b = wire[i];
            edges.push([group(a), group(b), offset(a) - offset(b) + 1]);
          }
          // Reserve the entire window on every touched wire, including leading
          // and trailing identities and entirely empty rows in a pattern.
          for (let dy = 0; dy < pattern.length; dy++) {
            const { start, expected } = selected[dy], wire = graph.wires[row + dy];
            if (start > 0) {
              const before = wire[start - 1];
              edges.push([group(before), 0, offset(before) + 1]);
            }
            if (start + expected.length < wire.length) {
              const after = wire[start + expected.length];
              edges.push([0, group(after), width - offset(after)]);
            }
          }
          const starts = Array(graph.nodes.length + 1).fill(0);
          let changed = false;
          for (let pass = 0; pass <= graph.nodes.length + 1; pass++) {
            changed = false;
            for (const [from, to, distance] of edges) if (starts[to] < starts[from] + distance) {
              starts[to] = starts[from] + distance; changed = true;
            }
            if (!changed) break;
          }
          if (changed) return; // A positive constraint cycle: this window is impossible.
          const columns = graph.nodes.map(node => starts[group(node.id)] + offset(node.id));
          const layout = drawGraph(graph, columns, Math.max(2, starts[0] + width));
          if (!matches(layout, pattern, row, starts[0])) return;
          const move = { rule: rule.id, row, column: starts[0] };
          const next = applyMove(layout, move), key = circuitKey(compactCircuit(next));
          if (key === sourceKey || results.has(key)) return;
          const prefix = circuitKey(layout) === circuitKey(circuit) ? [] : [{ rule: 'arrange', row: 0, column: 0, circuit: layout }];
          results.set(key, { move, next, prefix });
        }
        visit(0);
      }
    }
  }
  return [...results.values()];
}

// A rewrite removes at most two single-wire gates OR two linked gates. Count
// their required cancellations separately; layout changes affect neither count.
export function lowerBound(circuit) {
  const { singles, linked } = gateCounts(circuit);
  return Math.ceil(singles / 2) + Math.ceil(linked / 2);
}

export function seededRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ value >>> 15, value | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function solveShortest(circuit, { maxDepth = 16, maxNodes = 150000, allowedRules } = {}) {
  validateCircuit(circuit);
  let nodes = 0, aborted = false;
  const path = [];
  const bound = current => {
    const basic = lowerBound(current);
    if (!allowedRules || allowedRules.includes('cancel-cz')) return basic;
    let cz = 0, xx = 0, h = 0, linked = 0;
    for (let row = 0; row < current.length; row++) for (let column = 0; column < current[0].length; column++) {
      const cell = current[row][column];
      if (cell === 'H') h++;
      if (cell.endsWith('U')) {
        linked++;
        if (cell === 'ZU' && current[row + 1][column] === 'ZD') cz++;
        if (cell === 'XU' && current[row + 1][column] === 'XD') xx++;
      }
    }
    // Without the learned CZ shortcut, each CZ/XX node must change basis.
    // H/2 - CZ + XX is invariant under linked basis changes, so a negative
    // initial balance requires additional H-generating rewrites as well.
    return Math.max(basic, Math.ceil(linked / 2) + cz + xx + Math.max(0, cz - xx - Math.floor(h / 2)));
  };
  for (let limit = bound(circuit); limit <= maxDepth; limit++) {
    const seen = new Map();
    function search(current, depth) {
      if (isSolved(current)) return [...path];
      if (depth + bound(current) > limit) return null;
      if (++nodes > maxNodes) { aborted = true; return null; }
      const key = circuitKey(compactCircuit(current));
      if ((seen.get(key) ?? Infinity) <= depth) return null;
      seen.set(key, depth);
      const candidates = getRewriteMoves(current, { allowedRules, maxLowerBound: limit - depth - 1 }).map(candidate => ({ ...candidate, estimate: bound(candidate.next) }));
      candidates.sort((a, b) => a.estimate - b.estimate);
      for (const { move, next, prefix, estimate } of candidates) {
        if (depth + 1 + estimate > limit) continue;
        path.push(...prefix, move);
        const result = search(next, depth + 1);
        if (result) return result;
        path.splice(path.length - prefix.length - 1);
        if (aborted) return null;
      }
      return null;
    }
    const solution = search(circuit, 0);
    if (solution) return { status: 'optimal', solution, optimalMoves: sequenceCost(solution), nodes };
    if (aborted) return { status: 'limit', nodes };
  }
  return { status: 'limit', nodes };
}

export function parseCircuit(text) {
  const rows = text.trim().split(/\n/).map(row => row.trim().split(/[\s,]+/));
  return validateCircuit(rows);
}

// Independently evaluate up to four wires for custom-circuit validation. A linked
// X endpoint is a Z endpoint conjugated by H on that wire (also covers two X ends).
export function isIdentity(circuit) {
  validateCircuit(circuit);
  const size = 1 << circuit.length;
  const hadamard = (state, row) => {
    const mask = 1 << row;
    for (let i = 0; i < size; i++) if (!(i & mask)) {
      const a = state[i], b = state[i | mask];
      state[i] = (a + b) / Math.SQRT2; state[i | mask] = (a - b) / Math.SQRT2;
    }
  };
  for (let input = 0; input < size; input++) {
    const state = Array(size).fill(0); state[input] = 1;
    for (let column = 0; column < circuit[0].length; column++) for (let row = 0; row < circuit.length; row++) {
      const cell = circuit[row][column], mask = 1 << row;
      if (cell === 'H') hadamard(state, row);
      if (cell === 'X') for (let i = 0; i < size; i++) if (!(i & mask)) [state[i], state[i | mask]] = [state[i | mask], state[i]];
      if (cell === 'Z') for (let i = 0; i < size; i++) if (i & mask) state[i] *= -1;
      if (cell.endsWith('U')) {
        const lower = circuit[row + 1][column], mask2 = 1 << (row + 1);
        if (cell === 'XU') hadamard(state, row);
        if (lower === 'XD') hadamard(state, row + 1);
        for (let i = 0; i < size; i++) if ((i & mask) && (i & mask2)) state[i] *= -1;
        if (cell === 'XU') hadamard(state, row);
        if (lower === 'XD') hadamard(state, row + 1);
      }
    }
    if (state.some((value, output) => Math.abs(value - (input === output ? 1 : 0)) > 1e-9)) return false;
  }
  return true;
}
