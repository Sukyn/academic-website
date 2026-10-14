import { ScoreError, fetchJson } from './http.js';
import { populateDailyArchive } from './daily-ui.js';

/** Daily transport, server clock and refresh lifecycle; gameplay stays in the caller. */
export function createDailySession({
  game, onPuzzle, update, selectedDate, isBusy = () => false, fallback,
  settleDelay = 50, get = id => document.getElementById(id),
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
      try { response = await fetchJson(`/api/daily?${params}`, job, { cache: 'no-store' }); }
      catch (error) {
        if (job.signal.aborted || error instanceof ScoreError || !fallback) throw error;
        response = fallback(date);
      }
      if (request !== job) return;
      // The caller owns the playable puzzle. Retain only clock/archive metadata here.
      const { puzzle, ...metadata } = response;
      info = metadata; received = performance.now(); loading = false;
      onPuzzle({ ...metadata, puzzle }, select);
      if (request !== job) return;
      const range = `${info.startDate}/${info.today}`;
      if (range !== archiveRange) {
        populateDailyArchive(get('daily-date'), info);
        archiveRange = range;
      }
      get('daily-date').value = selectedDate() ?? info.today;
      get('daily-status').textContent = info.offline ? 'Offline practice · online scores unavailable.' : '';
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
    // Refresh score eligibility after midnight without replacing an ongoing round.
    update();
    return load(selectedDate(), false);
  }

  return { load, refresh, cancel, serverTime, get info() { return info; }, get loading() { return loading; } };
}
