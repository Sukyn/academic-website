import { DAILY_START, DAILY_TIME_ZONE, dailyBounds, dailyDate, dailyPuzzle, validDailyDate } from "../src/lib/quantum-golf/daily.js";

export default {
  async fetch(request: Request) {
    const headers = { "Cache-Control": "no-store" };
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, "Allow": "GET" } });
    const serverNow = Date.now();
    const today = dailyDate(serverNow);
    const date = new URL(request.url).searchParams.get("date") ?? today;
    if (!validDailyDate(date, serverNow)) {
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
