import { DAILY_START, dailyPuzzle } from "../src/lib/quantum-golf/daily.js";
import { DAILY_TIME_ZONE, dailyBounds, dailyDate, validDailyDate } from "../src/lib/games/daily-calendar.js";

export default {
  async fetch(request: Request) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, "Allow": "GET" } });
    const params = new URL(request.url).searchParams;
    if (params.has("game") && params.get("game") !== "quantum-golf") {
      return Response.json({ error: "Choose a supported game." }, { status: 400, headers });
    }
    const serverNow = Date.now();
    const today = dailyDate(serverNow);
    const date = params.get("date") ?? today;
    if (!validDailyDate(date, serverNow, DAILY_START)) {
      return Response.json({ error: "Choose an available daily puzzle." }, { status: 400, headers });
    }
    const { target, epsilon, optimalMoves } = dailyPuzzle(date);
    const bounds = dailyBounds(date), acceptingScores = date === today;
    return Response.json({
      today, startDate: DAILY_START, date, timeZone: DAILY_TIME_ZONE, serverNow,
      ...bounds, nextChangeAt: acceptingScores ? bounds.closesAt : dailyBounds(today).closesAt,
      puzzle: { target, epsilon, optimalMoves }, acceptingScores,
    }, { headers });
  },
};
