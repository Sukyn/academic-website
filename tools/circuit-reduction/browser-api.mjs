// Lightweight browser transport fixture. Puzzle and replay validation use the
// real game registry; in-memory records do not exercise SQL or storage.
import { getGame } from '../../src/lib/games/server.js';
import { SubmissionError } from '../../src/lib/games/submission.js';
import { dailyMetadata } from '../../src/lib/games/daily-calendar.js';

export function createBrowserApi({ now = process.env.GAME_TEST_TIME ? Date.parse(process.env.GAME_TEST_TIME) : Date.now() } = {}) {
  if (!Number.isFinite(now)) throw new RangeError('Choose a valid browser fixture time.');
  const records = new Map();
  const completed = new Map();
  let completionId = 0;

  function completionBoard(board, player = {}) {
    const entries = [...(completed.get(`${board.campaign}:${board.level}`)?.values() ?? [])]
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);
    const currentPlayer = entries.find(entry => entry.id === player.id || entry.name === player.name) ?? null;
    return { entries, currentPlayer, total: entries.length };
  }

  function getDaily(gameId, chosen) {
    const game = getGame(gameId), metadata = dailyMetadata(chosen, game.startDate, now);
    return { ...metadata, acceptingScores: metadata.acceptingScores && !game.completionOnly,
      puzzle: game.dailyPuzzle(metadata.date) };
  }

  async function install(surface) {
    await surface.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), params = url.searchParams;
      let body, status = 200;
      try {
        if (url.pathname === '/api/daily' && request.method() === 'GET') {
          body = getDaily(params.get('game') ?? undefined, params.get('date') ?? undefined);
        } else if (url.pathname === '/api/leaderboard') {
          const urlGame = getGame(params.get('game') ?? undefined);
          let board, record;
          if (request.method() === 'POST') {
            const payload = JSON.parse(request.postData());
            const game = Object.hasOwn(payload, 'game') ? getGame(payload.game) : urlGame;
            if (params.has('game') && game !== urlGame) throw new SubmissionError('Choose one game for this score.');
            const score = game.validateSubmission(payload, now);
            if (game.completionOnly) {
              const key = `${score.campaign}:${score.level}`;
              if (!completed.has(key)) completed.set(key, new Map());
              const players = completed.get(key);
              if (!players.has(score.name)) players.set(score.name, { id: ++completionId, name: score.name, completed: true });
              body = completionBoard(score, { name: score.name });
            } else {
              record = { id: 1, name: score.name, moves: score.moves, rank: 1 };
              records.set(`${score.campaign}:${score.level}`, record);
              body = { entries: [record], currentPlayer: record, total: 1 };
            }
            status = 201;
          } else if (request.method() === 'GET') {
            board = urlGame.getBoard({
              ...(params.has('level') ? { level: params.get('level') } : {}),
              ...(params.has('date') ? { date: params.get('date') } : {}),
            }, now);
            if (urlGame.completionOnly) body = completionBoard(board, { id: Number(params.get('player')) });
            else {
              record = records.get(`${board.campaign}:${board.level}`);
              body = { entries: record ? [record] : [],
                currentPlayer: record && params.get('player') === String(record.id) ? record : null,
                total: record ? 1 : 0 };
            }
          } else { status = 405; body = { error: 'Unsupported fixture method.' }; }
        } else { status = 404; body = { error: 'Unknown fixture route.' }; }
      } catch (error) {
        status = error instanceof SubmissionError ? error.status : error instanceof RangeError ? 400 : 500;
        body = { error: error instanceof SubmissionError || error instanceof RangeError ? error.message : 'Browser fixture request failed.' };
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
        headers: { 'Cache-Control': 'no-store' } });
    });
  }

  return { getDaily, install };
}
