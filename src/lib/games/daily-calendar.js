// Shared civil calendar for every daily game. Midnight and score deadlines
// use Paris time, including days that gain or lose an hour at DST changes.
export const DAILY_TIME_ZONE = 'Europe/Paris';
export const DAY = 86_400_000;
const paris = new Intl.DateTimeFormat('en', {
  timeZone: DAILY_TIME_ZONE, calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parts(timestamp) {
  return Object.fromEntries(paris.formatToParts(timestamp)
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

export function dateTimestamp(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError('Choose a date in YYYY-MM-DD format.');
  }
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new RangeError('Choose a valid calendar date.');
  }
  return timestamp;
}

export function dailyDate(now = Date.now()) {
  const { year, month, day } = parts(now);
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

export function validDailyDate(date, now = Date.now(), startDate = '0000-01-01') {
  try {
    dateTimestamp(date);
    return date >= startDate && date <= dailyDate(now);
  } catch {
    return false;
  }
}

function midnight(utcDate) {
  let result = utcDate;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { year, month, day, hour, minute, second } = parts(result);
    const local = new Date(0);
    local.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    local.setUTCHours(Number(hour), Number(minute), Number(second), 0);
    const corrected = utcDate - (local.getTime() - result);
    if (corrected === result) break;
    result = corrected;
  }
  return result;
}

export function dailyBounds(date) {
  const timestamp = dateTimestamp(date);
  return { opensAt: midnight(timestamp), closesAt: midnight(timestamp + DAY) };
}
