import { neon } from "@neondatabase/serverless";
import { getGame } from "../src/lib/games/server.js";
import { readSubmission, SubmissionError } from "../src/lib/games/submission.js";

function getSql(request: Request) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new SubmissionError("Scores are temporarily unavailable. Try again.", 503);
  return neon(url, {
    fetchOptions: { signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]) },
  });
}

function checkOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if ((origin && origin !== new URL(request.url).origin) ||
    (request.method === "POST" && request.headers.get("Sec-Fetch-Site") === "cross-site")) {
    throw new SubmissionError("Origin is not allowed.", 403);
  }
  if (request.method === "POST" &&
    request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new SubmissionError("Send scores as JSON.", 415);
  }
}

function number(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid score data.");
  return result;
}

async function board(sql: ReturnType<typeof getSql>, campaign: string, level: number, player: { id?: number; name?: string } = {}) {
  const rows = await sql`
    WITH best AS (
      SELECT DISTINCT ON (name) id, name, moves, created_at
      FROM scores WHERE campaign = ${campaign} AND level = ${level}
      ORDER BY name, moves, created_at, id
    ), ranked AS (
      SELECT id, name, moves,
        ROW_NUMBER() OVER (ORDER BY moves, created_at, id) AS rank,
        COUNT(*) OVER () AS total
      FROM best
    ), selected_player AS (
      SELECT name FROM scores WHERE campaign = ${campaign} AND level = ${level}
        AND (id = ${player.id ?? null} OR name = ${player.name ?? null}) LIMIT 1
    )
    SELECT ranked.*, name = (SELECT name FROM selected_player) AS is_player
    FROM ranked WHERE total < 10 OR rank <= 5
      OR ABS(rank - (SELECT rank FROM ranked WHERE name = (SELECT name FROM selected_player))) <= 2
    ORDER BY rank
  `;
  const entries = rows.map(row => ({
    id: number(row.id), name: String(row.name), moves: number(row.moves), rank: number(row.rank),
  }));
  const mine = rows.findIndex(row => row.is_player === true);
  return { total: rows[0] ? number(rows[0].total) : 0, entries, currentPlayer: mine < 0 ? null : entries[mine] };
}

async function completions(sql: ReturnType<typeof getSql>, campaign: string, level: number, player: { id?: number; name?: string } = {}) {
  const rows = await sql`
    WITH ordered AS (
      SELECT id, name, COUNT(*) OVER () AS total,
        ROW_NUMBER() OVER (ORDER BY name, id) AS position
      FROM completions WHERE campaign = ${campaign} AND level = ${level}
    ), selected_player AS (
      SELECT id FROM completions WHERE campaign = ${campaign} AND level = ${level}
        AND (id = ${player.id ?? null} OR name = ${player.name ?? null}) LIMIT 1
    )
    SELECT id, name, total, id = (SELECT id FROM selected_player) AS is_player
    FROM ordered WHERE position <= 10 OR id = (SELECT id FROM selected_player)
    ORDER BY name, id
  `;
  const entries = rows.map(row => ({ id: number(row.id), name: String(row.name), completed: true }));
  const mine = rows.findIndex(row => row.is_player === true);
  return { total: rows[0] ? number(rows[0].total) : 0, entries, currentPlayer: mine < 0 ? null : entries[mine] };
}

export default {
  async fetch(request: Request) {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(null, { status: 405, headers: { "Allow": "GET, POST", "Cache-Control": "no-store" } });
    }
    try {
      checkOrigin(request);
      const params = new URL(request.url).searchParams;
      const game = getGame(params.get("game") ?? undefined);
      if (request.method === "GET") {
        const selected = game.getBoard({
          ...(params.has("level") ? { level: params.get("level") } : {}),
          ...(params.has("date") ? { date: params.get("date") } : {}),
        });
        const rawPlayer = params.get("player");
        const id = rawPlayer === null ? undefined : Number(rawPlayer);
        if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) {
          throw new SubmissionError("Choose a valid player record.");
        }
        const read = 'completionOnly' in game ? completions : board;
        return Response.json(await read(getSql(request), selected.campaign, selected.level, { id }), {
          headers: { "Cache-Control": id === undefined ? "public, max-age=15" : "no-store" },
        });
      }
      let submissionBytes = 0;
      const input = await readSubmission(request, game.maxBytes,
        size => { submissionBytes = size; });
      const payloadGame = input && typeof input === "object" && Object.hasOwn(input, "game")
        ? getGame(input.game) : game;
      if (params.has("game") && payloadGame !== game) throw new SubmissionError("Choose one game for this score.");
      if (submissionBytes > payloadGame.maxBytes) {
        throw new SubmissionError("Submission is too large.", 413);
      }
      const score = payloadGame.validateSubmission(input);
      const sql = getSql(request);
      if ('completionOnly' in payloadGame) {
        await sql`
          INSERT INTO completions (campaign, level, name)
          VALUES (${score.campaign}, ${score.level}, ${score.name})
          ON CONFLICT (campaign, level, name) DO NOTHING
        `;
        return Response.json(await completions(sql, score.campaign, score.level, { name: score.name }), {
          status: 201, headers: { "Cache-Control": "no-store" },
        });
      }
      if ("date" in score) {
        // Use the database clock in the write itself: a request that waits across
        // Paris midnight cannot slip onto yesterday's leaderboard.
        const inserted = await sql`
          WITH scoring_time AS MATERIALIZED (SELECT clock_timestamp() AS instant)
          INSERT INTO scores (campaign, level, name, moves, created_at)
          SELECT ${score.campaign}, ${score.level}, ${score.name}, ${score.moves},
            FLOOR(EXTRACT(EPOCH FROM instant) * 1000)::bigint
          FROM scoring_time
          WHERE instant >= to_timestamp(${score.opensAt} / 1000.0)
            AND instant < to_timestamp(${score.closesAt} / 1000.0)
          ON CONFLICT (campaign, level, name, moves) DO UPDATE SET id = scores.id
            WHERE clock_timestamp() >= to_timestamp(${score.opensAt} / 1000.0)
              AND clock_timestamp() < to_timestamp(${score.closesAt} / 1000.0)
          RETURNING id
        `;
        if (!inserted.length) throw new SubmissionError("This puzzle's leaderboard is closed.", 409);
      } else {
        await sql`
          INSERT INTO scores (campaign, level, name, moves, created_at)
          VALUES (${score.campaign}, ${score.level}, ${score.name}, ${score.moves}, ${Date.now()})
          ON CONFLICT (campaign, level, name, moves) DO NOTHING
        `;
      }
      return Response.json(await board(sql, score.campaign, score.level, { name: score.name }), {
        status: 201, headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const known = error instanceof SubmissionError;
      if (!known || error.status >= 500) {
        // Database errors can contain credentials or submitted names. Log only
        // enough metadata to distinguish configuration, timeout and SQL errors.
        const code = (error as { code?: unknown } | null)?.code;
        const name = error instanceof Error ? error.name : "Error";
        console.error("Game leaderboard failed.", {
          configured: Boolean(process.env.DATABASE_URL),
          error: ["Error", "TypeError", "AbortError", "TimeoutError", "NeonDbError"].includes(name) ? name : "Error",
          code: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
        });
      }
      return Response.json({ error: known ? error.message : "Scores are temporarily unavailable. Try again." }, {
        status: known ? error.status : 503, headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
