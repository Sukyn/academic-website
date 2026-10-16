/** Games present server-validated progress using textContent. */
export function renderLeaderboard({ entries = [], currentPlayer = null, total = 0 } = {},
  { optimalMoves, benchmarkLabel = 'Optimal', unit = 'move', completionOnly = false, get = id => document.getElementById(id) } = {}) {
  if (!completionOnly) get('player-rank').textContent = currentPlayer
    ? `Your rank: ${currentPlayer.rank} / ${total} · Best: ${currentPlayer.moves} ${currentPlayer.moves === 1 ? unit : `${unit}s`}` : '';
  const hasBenchmark = !completionOnly && optimalMoves != null;
  const rows = hasBenchmark ? [{ rank: '—', name: benchmarkLabel, moves: optimalMoves }, ...entries] : entries;
  for (const id of ['leaderboard-body', 'result-leaderboard-body']) {
    get(id).replaceChildren(...rows.map((entry, index) => {
      const row = document.createElement('tr');
      const benchmark = hasBenchmark && index === 0, own = !benchmark && entry.id === currentPlayer?.id;
      row.className = benchmark ? 'benchmark' : own ? 'current-player' : '';
      const name = entry.name + (own ? ' (you)' : '');
      for (const value of completionOnly ? [name] : [entry.rank, name, entry.moves]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      if (completionOnly) {
        const cell = document.createElement('td'), checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.disabled = true;
        checkbox.setAttribute('aria-label', 'Completed');
        cell.appendChild(checkbox); row.appendChild(cell);
      }
      return row;
    }));
  }
  return currentPlayer;
}
