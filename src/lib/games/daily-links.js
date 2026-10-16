/** Open Daily mode when arriving from the shared daily-puzzle links. */
export function startDailyFromLink(daily) {
  if (new URLSearchParams(window.location.search).get('daily') !== '1') return false;
  void daily.load(undefined, true);
  return true;
}
