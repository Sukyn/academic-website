import { neon } from "@neondatabase/serverless";
import {
  CAMPAIGN, getLevel, readSubmission, SubmissionError, validateSubmission,
} from "../src/lib/quantum-golf/leaderboard.js";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new SubmissionError("Scores are temporarily unavailable. Try again.", 503);
  return neon(url);
}

function checkOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new SubmissionError("Origin is not allowed.", 403);
  }
}

function number(value: unknown) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid score data.");
  return result;
}

async function board(level: number, player: { id?: number; name?: string } = {}) {
  const sql = getSql();
  const rows = await sql`
    WITH attempts AS (
      SELECT id, name, moves, created_at,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY moves, created_at, id) AS attempt
      FROM scores WHERE campaign = ${CAMPAIGN} AND level = ${level}
    ), ranked AS (
      SELECT id, name, moves,
        ROW_NUMBER() OVER (ORDER BY moves, created_at, id) AS rank,
        COUNT(*) OVER () AS total
      FROM attempts WHERE attempt = 1
    ), selected_player AS (
      SELECT name FROM scores WHERE campaign = ${CAMPAIGN} AND level = ${level}
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
      if (request.method === "GET") {
        const params = new URL(request.url).searchParams;
        const level = getLevel(params.get("level")).id;
        const rawPlayer = params.get("player");
        const id = rawPlayer === null ? undefined : Number(rawPlayer);
        if (id !== undefined && (!Number.isSafeInteger(id) || id < 1)) {
          throw new SubmissionError("Choose a valid player record.");
        }
        return Response.json(await board(level, { id }), {
          headers: { "Cache-Control": id === undefined ? "public, max-age=15" : "no-store" },
        });
      }
      const score = validateSubmission(await readSubmission(request));
      const sql = getSql();
      await sql`
        INSERT INTO scores (campaign, level, name, sequence, moves, created_at)
        VALUES (${score.campaign}, ${score.level}, ${score.name}, ${score.sequence}, ${score.moves}, ${Date.now()})
        ON CONFLICT (campaign, level, name, sequence) DO NOTHING
      `;
      return Response.json(await board(score.level, { name: score.name }), {
        status: 201, headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const known = error instanceof SubmissionError;
      return Response.json({ error: known ? error.message : "Scores are temporarily unavailable. Try again." }, {
        status: known ? error.status : 503, headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
