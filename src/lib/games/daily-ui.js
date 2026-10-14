const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
});

export const formatPuzzleDate = date => dateFormat.format(new Date(`${date}T12:00:00Z`));

export function populateDailyArchive(select, { today, startDate, selectedDate = today }) {
  const options = [];
  for (let day = Date.parse(`${today}T00:00:00Z`), first = Date.parse(`${startDate}T00:00:00Z`);
    day >= first; day -= 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    const option = document.createElement('option');
    option.value = date;
    option.textContent = date === today ? 'Today' : formatPuzzleDate(date);
    options.push(option);
  }
  select.replaceChildren(...options);
  select.value = selectedDate;
}
