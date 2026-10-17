import { getGame } from "../src/lib/games/server.js";
import { SubmissionError } from "../src/lib/games/submission.js";
import { dailyMetadata } from "../src/lib/games/daily-calendar.js";

export default {
  async fetch(request: Request) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, "Allow": "GET" } });
    try {
      const params = new URL(request.url).searchParams;
      const game = getGame(params.get("game") ?? undefined);
      let metadata: ReturnType<typeof dailyMetadata>;
      try {
        metadata = dailyMetadata(params.get("date") ?? undefined, game.startDate);
      } catch (error) {
        if (error instanceof RangeError) throw new SubmissionError(error.message);
        throw error;
      }
      return Response.json({ ...metadata, acceptingScores: metadata.acceptingScores && !('completionOnly' in game),
        puzzle: game.dailyPuzzle(metadata.date) }, { headers });
    }
    catch (error) {
      const known = error instanceof SubmissionError;
      if (!known) console.error("Game daily puzzle failed.");
      return Response.json({ error: known ? error.message : "Puzzles are temporarily unavailable. Try again." }, {
        status: known ? error.status : 503, headers,
      });
    }
  },
};
