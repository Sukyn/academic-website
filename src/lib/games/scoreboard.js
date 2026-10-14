import { ScoreError, fetchJson } from './http.js';
import { renderLeaderboard } from './leaderboard.js';

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
      render(data);
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
