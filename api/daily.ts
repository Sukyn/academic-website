import { getGame } from "../src/lib/games/server.js";
import { SubmissionError } from "../src/lib/games/submission.js";
import { dailyMetadata } from "../src/lib/games/daily-calendar.js";

export default {
  async fetch(request: Request) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, "Allow": "GET" } });
    const params = new URL(request.url).searchParams;
    let game: ReturnType<typeof getGame>;
    let metadata: ReturnType<typeof dailyMetadata>;
    try {
      game = getGame(params.get("game") ?? undefined);
      metadata = dailyMetadata(params.get("date") ?? undefined, game.startDate);
    }
    catch (error) {
      if (!(error instanceof SubmissionError || error instanceof RangeError)) throw error;
      return Response.json({ error: error.message }, { status: error instanceof SubmissionError ? error.status : 400, headers });
    }
    return Response.json({ ...metadata, puzzle: game.dailyPuzzle(metadata.date) }, { headers });
  },
};
