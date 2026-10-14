/** Both games present the server-validated ranks using textContent. */
export function renderLeaderboard({ entries = [], currentPlayer = null, total = 0 } = {},
  { optimalMoves, unit = 'move', get = id => document.getElementById(id) } = {}) {
  get('player-rank').textContent = currentPlayer
    ? `Your rank: ${currentPlayer.rank} / ${total} · Best: ${currentPlayer.moves} ${currentPlayer.moves === 1 ? unit : `${unit}s`}` : '';
  const ranked = [{ rank: '—', name: 'Optimal', moves: optimalMoves }, ...entries];
  for (const id of ['leaderboard-body', 'result-leaderboard-body']) {
    get(id).replaceChildren(...ranked.map((entry, index) => {
      const row = document.createElement('tr');
      const own = index > 0 && entry.id === currentPlayer?.id;
      row.className = index === 0 ? 'benchmark' : own ? 'current-player' : '';
      for (const value of [entry.rank, entry.name + (own ? ' (you)' : ''), entry.moves]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }
      return row;
    }));
  }
  return currentPlayer;
}
