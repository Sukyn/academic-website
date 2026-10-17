import { getRule } from './engine.js';

export const REWRITE_DURATION = 400;

const samePattern = (circuit, pattern, row, column) => pattern.every((line, y) => line.every((cell, x) => circuit[row + y]?.[column + x] === cell));

// Preserve nearby equal glyphs on each wire. Exact positions take priority so
// a repeated control that stays put never jumps to a different linked gate.
function matchGates(before, after) {
  const pairs = [];
  for (let from = 0; from < before.length; from++) for (let to = 0; to < after.length; to++) {
    if (before[from].cell === after[to].cell && before[from].row === after[to].row) {
      pairs.push({ from, to, distance: Math.abs(before[from].column - after[to].column) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.from - b.from || a.to - b.to);
  const matchedBefore = new Set(), matchedAfter = new Set(), gates = [];
  for (const { from, to } of pairs) {
    if (matchedBefore.has(from) || matchedAfter.has(to)) continue;
    matchedBefore.add(from); matchedAfter.add(to);
    gates.push({ cell: before[from].cell, row: before[from].row, fromColumn: before[from].column, toColumn: after[to].column, phase: 'move' });
  }
  for (const [source, matched, phase] of [[before, matchedBefore, 'out'], [after, matchedAfter, 'in']]) {
    const remaining = source.filter((_, index) => !matched.has(index));
    for (let index = 0; index < remaining.length; index++) {
      const gate = remaining[index];
      // A cancelling pair meets between its two slots. The reverse rewrite
      // starts at the same meeting point, including the two Hs in HZH / HXH.
      const siblings = remaining.filter(item => item.row === gate.row && item.cell === gate.cell);
      const sibling = siblings[siblings.indexOf(gate) ^ 1];
      const middle = sibling ? (gate.column + sibling.column) / 2 : gate.column;
      gates.push({ cell: gate.cell, row: gate.row, fromColumn: phase === 'in' ? middle : gate.column, toColumn: phase === 'out' ? middle : gate.column, phase });
    }
  }
  return gates;
}

/** Describe a rule rewrite without changing either saved circuit. */
export function createRewriteTransition(before, after, move) {
  const rule = getRule(move?.rule);
  if (!rule || !Number.isInteger(move.row) || !Number.isInteger(move.column) || move.row < 0 || move.column < 0 ||
      !Array.isArray(before) || !Array.isArray(after) || before.length !== after.length ||
      !before.length || !Array.isArray(before[0]) || before[0].length !== after[0]?.length ||
      before.some((line, row) => !Array.isArray(line) || !Array.isArray(after[row]) || line.length !== before[0].length || after[row].length !== line.length)) return null;
  const { row, column } = move, height = rule.left.length, width = rule.left[0].length;
  if (!(samePattern(before, rule.left, row, column) && samePattern(after, rule.right, row, column)) &&
      !(samePattern(before, rule.right, row, column) && samePattern(after, rule.left, row, column))) return null;
  const inside = (y, x) => y >= row && y < row + height && x >= column && x < column + width;
  let changed = false;
  for (let y = 0; y < before.length; y++) for (let x = 0; x < before[y].length; x++) {
    if (before[y][x] !== after[y][x]) {
      if (!inside(y, x)) return null;
      changed = true;
    }
  }
  if (!changed) return null;

  const scope = new Set();
  for (const circuit of [before, after]) for (let y = row; y < row + height; y++) for (let x = column; x < column + width; x++) {
    scope.add(`${y}:${x}`);
    if (circuit[y][x].endsWith('U')) scope.add(`${y + 1}:${x}`);
    if (circuit[y][x].endsWith('D')) scope.add(`${y - 1}:${x}`);
  }
  const collect = circuit => [...scope].map(key => {
    const [y, x] = key.split(':').map(Number);
    return { cell: circuit[y]?.[x], row: y, column: x };
  }).filter(gate => gate.cell && gate.cell !== '.');
  const oldGates = collect(before), newGates = collect(after), gates = matchGates(oldGates, newGates);
  const oldLinks = oldGates.filter(gate => gate.cell.endsWith('U'));
  const newLinks = newGates.filter(gate => gate.cell.endsWith('U'));
  const links = [], used = new Set();
  for (const link of oldLinks) {
    const endpoint = y => gates.find(gate => gate.row === y && gate.phase !== 'in' && gate.fromColumn === link.column);
    const upper = endpoint(link.row), lower = endpoint(link.row + 1);
    const destination = newLinks.findIndex(gate => gate.row === link.row && gate.column === upper?.toColumn);
    if (upper && lower && upper.phase === lower.phase && upper.toColumn === lower.toColumn &&
        (upper.phase === 'out' || destination >= 0 && !used.has(destination))) {
      links.push({ row: link.row, fromColumn: link.column, toColumn: upper.toColumn, phase: upper.phase });
      if (upper.phase === 'move') used.add(destination);
    } else links.push({ row: link.row, fromColumn: link.column, toColumn: link.column, phase: 'out' });
  }
  newLinks.forEach((link, index) => {
    if (used.has(index)) return;
    const endpoint = y => gates.find(gate => gate.row === y && gate.phase !== 'out' && gate.toColumn === link.column);
    const upper = endpoint(link.row), lower = endpoint(link.row + 1);
    const fromColumn = upper?.phase === 'in' && lower?.phase === 'in' && upper.fromColumn === lower.fromColumn ? upper.fromColumn : link.column;
    links.push({ row: link.row, fromColumn, toColumn: link.column, phase: 'in' });
  });
  return { gates, links };
}

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** Shared timing for the live SVG overlay and the exported canvas frames. */
export function transitionSample(item, progress) {
  const time = clamp(Number.isFinite(progress) ? progress : 0);
  const column = item.fromColumn + (item.toColumn - item.fromColumn) * smooth(time);
  if (item.phase === 'move') return { column, opacity: 1, scale: 1 };
  const visibility = item.phase === 'in' ? smooth(time / .8) : 1 - smooth((time - .2) / .8);
  return { column, opacity: visibility, scale: .18 + .82 * visibility };
}
