import { DAY } from './daily-calendar.js';

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});

export const formatPuzzleDate = date => dateFormat.format(new Date(`${date}T12:00:00Z`));

export function populateDailyArchive(select, { today, startDate }) {
  const options = [];
  for (let day = Date.parse(`${today}T00:00:00Z`), first = Date.parse(`${startDate}T00:00:00Z`);
    day >= first; day -= DAY) {
    const date = new Date(day).toISOString().slice(0, 10);
    const option = document.createElement('option');
    option.value = date;
    option.textContent = date === today ? 'Today' : formatPuzzleDate(date);
    options.push(option);
  }
  select.replaceChildren(...options);
}

export function bindDailyControls(session, get = id => document.getElementById(id)) {
  get('mode-daily').addEventListener('click', () => session.load());
  get('daily-toggle').addEventListener('click', () => {
    const open = get('daily-archive').hidden;
    get('daily-archive').hidden = !open;
    get('daily-toggle').setAttribute('aria-expanded', String(open));
    if (open && !session.info) session.load(undefined, false);
  });
  get('daily-date').addEventListener('change', event => session.load(event.target.value));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') session.refresh(); });
  window.addEventListener('focus', session.refresh);
}
