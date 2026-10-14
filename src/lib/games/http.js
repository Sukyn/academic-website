/** Server responses may expose only short, expected validation errors. */
export class ScoreError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function fetchJson(url, request, options = {}) {
  const timeout = setTimeout(() => request.abort(), 15_000);
  try {
    const response = await fetch(url, { ...options, signal: request.signal });
    const data = await response.json();
    if ([400, 408, 409, 413, 415, 429].includes(response.status) &&
      typeof data?.error === 'string' && data.error.length > 0 && data.error.length <= 160) {
      throw new ScoreError(data.error, response.status);
    }
    if (!response.ok) throw new Error('Scores unavailable');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
