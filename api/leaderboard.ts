import { neon } from "@neondatabase/serverless";
import {
  getBoard, validateSubmission,
} from "../src/lib/quantum-golf/leaderboard.js";
import { readSubmission, SubmissionError } from "../src/lib/games/submission.js";

function checkGame(value: unknown = "quantum-golf") {
  if (value !== "quantum-golf") {
    throw new SubmissionError("Choose a supported game.");
  }
}

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

export default {
  async fetch(request: Request) {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(null, { status: 405, headers: { "Allow": "GET, POST" } });
    }
    try {
      checkOrigin(request);
      const params = new URL(request.url).searchParams;
      checkGame(params.get("game") ?? undefined);
      if (request.method === "GET") {
        const selected = getBoard({
          ...(params.has("level") ? { level: params.get("level") } : {}),
          ...(params.has("date") ? { date: params.get("date") } : {}),
        });
        const rawPlayer = params.get("player");
        const id = rawPlayer === null ? undefined : Number(rawPlayer);
        if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) {
          throw new SubmissionError("Choose a valid player record.");
        }
        return Response.json(await board(getSql(request), selected.campaign, selected.level, { id }), {
          headers: { "Cache-Control": id === undefined ? "public, max-age=15" : "no-store" },
        });
      }
      const input = await readSubmission(request);
      if (input && typeof input === "object" && Object.hasOwn(input, "game")) checkGame(input.game);
      const score = validateSubmission(input);
      const sql = getSql(request);
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
        console.error("Game leaderboard failed.", {
          configured: Boolean(process.env.DATABASE_URL),
          error: error instanceof Error ? error.name : "Error",
          code: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
        });
      }
      return Response.json({ error: known ? error.message : "Scores are temporarily unavailable. Try again." }, {
        status: known ? error.status : 503, headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
