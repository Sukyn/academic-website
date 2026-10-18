/** Expand the cells touched by a gesture, without following shared controls twice. */
export function expandSelection(cells, gateCells) {
  const expanded = new Set(cells);
  for (const cell of cells) for (const linked of gateCells(cell)) expanded.add(linked);
  return expanded;
}

export function toggleSelection(selection, cells, gateCells) {
  const next = new Set(selection), remove = cells.every(cell => next.has(cell));
  for (const cell of cells) {
    if (remove) next.delete(cell); else next.add(cell);
  }
  // Restore only removed endpoints still needed by another selected gate.
  if (remove) {
    const required = expandSelection(next, gateCells);
    for (const cell of cells) if (required.has(cell)) next.add(cell);
  }
  return next;
}
