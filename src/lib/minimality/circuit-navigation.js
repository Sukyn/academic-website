export function moveCircuitFocus(positions, currentKey, direction, activeRow) {
  const current = positions.find(position => position.key === currentKey);
  if (!current) return null;
  const end = position => position.rowEnd ?? position.row;
  const clampRow = (position, row) => Math.max(position.row, Math.min(end(position), row));
  const row = clampRow(current, activeRow ?? current.row);
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
  const vertical = direction === 'ArrowUp' || direction === 'ArrowDown';
  const edge = direction === 'Home' || direction === 'End';
  if (!horizontal && !vertical && !edge) return null;
  const sign = ['ArrowLeft', 'ArrowUp', 'End'].includes(direction) ? -1 : 1;
  let next = null, primary = Infinity, secondary = Infinity;
  for (const candidate of positions) {
    let first, second;
    if (edge) {
      if (row < candidate.row || row > end(candidate)) continue;
      first = sign * candidate.column;
      second = 0;
    } else if (horizontal) {
      second = sign * (candidate.column - current.column);
      if (second <= 0) continue;
      first = Math.abs(clampRow(candidate, row) - row);
    } else {
      second = sign < 0 ? current.row - end(candidate) : candidate.row - end(current);
      if (second <= 0) continue;
      first = Math.abs(candidate.column - current.column);
    }
    if (first < primary || (first === primary && second < secondary)) {
      next = candidate;
      primary = first;
      secondary = second;
    }
  }
  return next && next.key !== currentKey ? { key: next.key, row: clampRow(next, row) } : null;
}
