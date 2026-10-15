import { ScoreError, fetchJson } from './http.js';
import { renderLeaderboard } from './leaderboard.js';
import { createRememberedName } from './remembered-name.js';
import { scoreName } from './submission.js';

function checkBoard(data, submitted = false, completionOnly = false) {
  const positive = value => Number.isSafeInteger(value) && value > 0;
  if (!data || !Number.isSafeInteger(data.total) || data.total < 0 ||
      !Array.isArray(data.entries) || data.entries.length > Math.min(completionOnly ? 11 : 10, data.total) ||
      (data.total > 0 && !data.entries.length) ||
      (completionOnly && data.entries.length < Math.min(10, data.total))) {
    throw new Error('Invalid leaderboard response.');
  }
  const validEntry = entry => entry && positive(entry.id) &&
    typeof entry.name === 'string' && entry.name.length <= 48 && entry.name.trim() &&
    Array.from(entry.name).length <= 24 && !/\p{C}/u.test(entry.name) &&
    (completionOnly ? entry.completed === true && !['rank', 'moves', 'optimalMoves', 'score'].some(key => Object.hasOwn(entry, key)) :
      positive(entry.rank) && entry.rank <= data.total && positive(entry.moves));
  const ids = new Set();
  let previousRank = 0;
  for (const entry of data.entries) {
    if (!validEntry(entry) || ids.has(entry.id) || (!completionOnly && entry.rank <= previousRank)) {
      throw new Error('Invalid leaderboard response.');
    }
    if (!completionOnly) previousRank = entry.rank;
    ids.add(entry.id);
  }
  const player = data.currentPlayer;
  const playerKeys = completionOnly ? ['id', 'name', 'completed'] : ['id', 'name', 'rank', 'moves'];
  if ((player !== null && (!validEntry(player) || !data.entries.some(entry =>
    playerKeys.every(key => entry[key] === player[key])))) ||
      (completionOnly && data.entries.length === 11 && data.entries[10].id !== player?.id)) {
    throw new Error('Invalid leaderboard response.');
  }
  if (submitted && !player) throw new Error('Invalid saved score response.');
  return data;
}

/** Score requests belong to a round. Resetting it invalidates even late replies. */
export function createScoreboard({
  selector, benchmark = () => ({}), canSubmit, sequence, update, onDailyClosed, completionOnly = false,
  get = id => document.getElementById(id),
}) {
  let player = null, boardRequest, scoreRequest, automatic = false, autoAttempted = false;
  const nickname = createRememberedName();
  const unavailable = completionOnly ? 'Completions temporarily unavailable.' : 'Scores temporarily unavailable.';

  function syncNickname() {
    get('nickname-form').hidden = !nickname.value;
    get('nickname-value').value = nickname.value;
    get('player-name').value = nickname.value;
  }

  get('nickname-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!get('nickname-form').reportValidity()) return;
    try {
      const persisted = nickname.remember(get('nickname-value').value);
      syncNickname();
      get('nickname-status').textContent = persisted ? 'Nickname saved.' : 'Nickname saved for this visit.';
    } catch (error) { get('nickname-status').textContent = error.message; }
  });
  get('nickname-forget').addEventListener('click', () => {
    const persisted = nickname.forget();
    syncNickname();
    get('nickname-status').textContent = '';
    if (!persisted) get('score-status').textContent = 'Nickname forgotten for this visit.';
    update();
  });
  syncNickname();

  function render(data = {}) {
    player = renderLeaderboard(data, { ...(completionOnly ? {} : benchmark()), completionOnly, get });
  }

  function cancelBoard() {
    boardRequest?.abort();
    boardRequest = null;
  }

  function dispose() {
    cancelBoard();
    scoreRequest?.abort();
    scoreRequest = null;
    automatic = false;
  }

  function reset() {
    dispose();
    player = null;
    autoAttempted = false;
    nickname.refresh(); syncNickname();
    get('nickname-status').textContent = '';
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
      render(checkBoard(data, false, completionOnly));
      update();
    } catch {
      if (boardRequest === request) get('leaderboard-status').textContent = unavailable;
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
    let name;
    try { name = scoreName(get('player-name').value); }
    catch {
      get('score-status').textContent = 'Use 1–24 characters.';
      return;
    }
    const selected = selector();
    if (!selected) return;
    nickname.refresh();
    await save(name, selected);
  }

  function autoSubmit() {
    if (autoAttempted || !canSubmit() || scoreRequest || player) return false;
    const revision = nickname.revision;
    nickname.refresh();
    if (nickname.value || nickname.revision !== revision) syncNickname();
    const selected = selector();
    if (!nickname.value || !selected) return false;
    autoAttempted = true;
    automatic = true;
    void save(nickname.value, selected);
    return true;
  }

  async function save(name, selected) {
    const revision = nickname.revision;
    const request = scoreRequest = new AbortController();
    get('score-status').textContent = 'Saving…';
    update();
    try {
      const data = await fetchJson('/api/leaderboard', request, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selected, name, sequence: sequence() }),
      });
      if (scoreRequest !== request) return;
      checkBoard(data, true, completionOnly);
      cancelBoard();
      render(data);
      // A changed/forgotten nickname must survive a late save response.
      nickname.refresh();
      if (nickname.revision === revision) { nickname.remember(player.name); syncNickname(); }
      get('score-status').textContent = completionOnly ? 'Completion saved.' : 'Score saved.';
      get('leaderboard-status').textContent = '';
    } catch (error) {
      if (scoreRequest !== request) return;
      get('score-status').textContent = error instanceof ScoreError ? error.message : unavailable;
      if (!completionOnly && error instanceof ScoreError && error.status === 409 && selected.date) onDailyClosed?.();
    } finally {
      if (scoreRequest === request) {
        scoreRequest = null;
        automatic = false;
        update();
      }
    }
  }

  return { load, submit, autoSubmit, reset, dispose,
    get player() { return player; },
    get submitting() { return Boolean(scoreRequest); },
    get automatic() { return automatic; },
  };
}
