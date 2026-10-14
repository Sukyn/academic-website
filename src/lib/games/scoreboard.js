import { ScoreError, fetchJson } from './http.js';
import { renderLeaderboard } from './leaderboard.js';

function checkBoard(data, submitted = false) {
  const positive = value => Number.isSafeInteger(value) && value > 0;
  if (!data || !Number.isSafeInteger(data.total) || data.total < 0 ||
      !Array.isArray(data.entries) || data.entries.length > Math.min(10, data.total) ||
      (data.total > 0 && !data.entries.length)) {
    throw new Error('Invalid leaderboard response.');
  }
  const ids = new Set();
  let previousRank = 0;
  for (const entry of data.entries) {
    if (!entry || !positive(entry.id) || !positive(entry.rank) || entry.rank <= previousRank ||
        entry.rank > data.total || !positive(entry.moves) || ids.has(entry.id) ||
        typeof entry.name !== 'string' || entry.name.length > 48 || !entry.name.trim() ||
        Array.from(entry.name).length > 24 || /\p{C}/u.test(entry.name)) {
      throw new Error('Invalid leaderboard response.');
    }
    previousRank = entry.rank; ids.add(entry.id);
  }
  const player = data.currentPlayer;
  if (player !== null && (!player || !data.entries.some(entry =>
    ['id', 'name', 'rank', 'moves'].every(key => entry[key] === player[key])))) {
    throw new Error('Invalid leaderboard response.');
  }
  if (submitted && !player) throw new Error('Invalid saved score response.');
  return data;
}

/** Score requests belong to a round. Resetting it invalidates even late replies. */
export function createScoreboard({
  selector, benchmark, canSubmit, sequence, update, onDailyClosed,
  get = id => document.getElementById(id),
}) {
  let player = null, boardRequest, scoreRequest;

  function render(data = {}) {
    player = renderLeaderboard(data, { ...benchmark(), get });
  }

  function cancelBoard() {
    boardRequest?.abort();
    boardRequest = null;
  }

  function dispose() {
    cancelBoard();
    scoreRequest?.abort();
    scoreRequest = null;
  }

  function reset() {
    dispose();
    player = null;
    get('score-status').textContent = '';
  }

  async function load() {
    cancelBoard();
    get('leaderboard-status').textContent = '';
    const selected = selector();
    if (!selected) return;
    if (!player) render();
    const params = new URLSearchParams(selected);
    if (player) params.set('player', player.id);
    const request = boardRequest = new AbortController();
    try {
      const data = await fetchJson(`/api/leaderboard?${params}`, request);
      if (boardRequest !== request) return;
      render(checkBoard(data));
      update();
    } catch {
      if (boardRequest === request) get('leaderboard-status').textContent = 'Scores temporarily unavailable.';
    } finally {
      if (boardRequest === request) boardRequest = null;
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit() || scoreRequest || player || !get('score-form').reportValidity()) {
      update();
      return;
    }
    const name = get('player-name').value.trim();
    if (!name || Array.from(name).length > 24) {
      get('score-status').textContent = 'Use 1–24 characters.';
      return;
    }
    const selected = selector();
    if (!selected) return;
    const request = scoreRequest = new AbortController();
    get('score-status').textContent = 'Saving…';
    update();
    try {
      const data = await fetchJson('/api/leaderboard', request, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selected, name, sequence: sequence() }),
      });
      if (scoreRequest !== request) return;
      checkBoard(data, true);
      cancelBoard();
      render(data);
      get('score-status').textContent = 'Score saved.';
      get('leaderboard-status').textContent = '';
    } catch (error) {
      if (scoreRequest !== request) return;
      get('score-status').textContent = error instanceof ScoreError ? error.message : 'Scores temporarily unavailable.';
      if (error instanceof ScoreError && error.status === 409 && selected.date) onDailyClosed?.();
    } finally {
      if (scoreRequest === request) {
        scoreRequest = null;
        update();
      }
    }
  }

  return { load, submit, reset, dispose,
    get player() { return player; },
    get submitting() { return Boolean(scoreRequest); },
  };
}
