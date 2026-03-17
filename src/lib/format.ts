const defaultDateFormatter = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

export function formatDate(date: Date) {
  return defaultDateFormatter.format(date);
}

export function readingTimeFromText(text: string, wordsPerMinute = 200) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / wordsPerMinute));
  return `${minutes} min read`;
}
