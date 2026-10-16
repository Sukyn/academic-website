import { ScoreError, fetchJson } from './http.js';
import { populateDailyArchive } from './daily-ui.js';
import { DAY, dailyMetadata, dateTimestamp } from './daily-calendar.js';

function checkResponse(response, date, startDate, validatePuzzle, ranked) {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      !response.puzzle || typeof response.puzzle !== 'object' || Array.isArray(response.puzzle) ||
      response.startDate !== startDate || !Number.isFinite(response.serverNow) || typeof response.acceptingScores !== 'boolean' ||
      (ranked && (!Number.isSafeInteger(response.puzzle.optimalMoves) || response.puzzle.optimalMoves < 1))) {
    throw new Error('Invalid daily puzzle response.');
  }
  const firstDay = dateTimestamp(response.startDate);
  const calendar = dailyMetadata(response.date, response.startDate, response.serverNow);
  // A corrupt server clock must not allocate millions of archive options.
  // This leaves more than a century of normal daily archives available.
  if ((dateTimestamp(calendar.today) - firstDay) / DAY + 1 > 50_000) {
    throw new Error('Daily archive is too large.');
  }
  if ((date && response.date !== date) ||
      ['date', 'today', 'opensAt', 'closesAt', 'nextChangeAt'].some(key => response[key] !== calendar[key]) ||
      (response.acceptingScores && (!calendar.acceptingScores || response.offline))) {
    throw new Error('Invalid daily puzzle response.');
  }
  validatePuzzle?.(response.puzzle);
  return response;
}

/** Daily transport, server clock and refresh lifecycle; gameplay stays in the caller. */
export function createDailySession({
  game, startDate, onPuzzle, update, selectedDate, isBusy = () => false, fallback, validatePuzzle, ranked = true,
  settleDelay = 50, offlineMessage = 'Offline practice · online scores unavailable.', get = id => document.getElementById(id),
}) {
  let info, received, request, timer, loading = false;
  let archiveRange;
  const serverTime = () => info ? info.serverNow + performance.now() - received : Date.now();

  function cancel() {
    request?.abort(); request = null;
    clearTimeout(timer); timer = null; loading = false;
    get('daily-status').textContent = '';
  }

  async function load(date, select = true) {
    if (select && isBusy()) return;
    cancel();
    const job = request = new AbortController();
    loading = select;
    get('daily-status').textContent = 'Loading…';
    update();
    try {
      const params = new URLSearchParams({ game, ...(date ? { date } : {}) });
      let response;
      try { response = checkResponse(await fetchJson(`/api/daily?${params}`, job, { cache: 'no-store' }), date, startDate, validatePuzzle, ranked); }
      catch (error) {
        if (job.signal.aborted || error instanceof ScoreError || !fallback) throw error;
        response = checkResponse(fallback(date), date, startDate, validatePuzzle, ranked);
      }
      if (request !== job) return;
      // The caller owns the playable puzzle. Retain only clock/archive metadata here.
      const { puzzle, ...metadata } = response;
      info = metadata; received = performance.now(); loading = false;
      onPuzzle(response, select);
      if (request !== job) return;
      const range = `${info.startDate}/${info.today}`;
      if (range !== archiveRange) {
        populateDailyArchive(get('daily-date'), info);
        archiveRange = range;
      }
      get('daily-date').value = selectedDate() ?? info.today;
      get('daily-status').textContent = info.offline ? offlineMessage : '';
      timer = setTimeout(refresh, Math.min(info.offline ? 60_000 : 2_147_483_647,
        Math.max(settleDelay, info.nextChangeAt - serverTime() + settleDelay)));
    } catch (error) {
      if (request !== job) return;
      get('daily-status').textContent = error instanceof ScoreError ? error.message : 'Daily puzzle unavailable. Try again.';
      // Bad archive dates need a new selection; outages can retry the requested date.
      if (!(error instanceof ScoreError && error.status === 400)) {
        const retry = () => {
          if (select && isBusy()) timer = setTimeout(retry, 1_000);
          else return load(date, select);
        };
        timer = setTimeout(retry, 60_000);
      }
    } finally {
      if (request === job) { request = null; loading = false; update(); }
    }
  }

  function refresh() {
    if (!info || request) return;
    // Refresh the calendar without replacing an ongoing round.
    return load(selectedDate(), false);
  }

  return { load, refresh, cancel, serverTime, get info() { return info; }, get loading() { return loading; } };
}
