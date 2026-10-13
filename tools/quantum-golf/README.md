# Quantum golf

Play at `/games/quantum-golf/`. See the [website README](../../README.md) for run and check commands, and [SETUP.md](SETUP.md) for shared scores and backups.

## Source

- `src/pages/games/quantum-golf.astro`: layout and controls.
- `src/scripts/quantum-golf.js`: game flow; `src/lib/quantum-golf/`: sphere, gates, puzzles, and score validation.
- `api/daily.ts` and `api/leaderboard.ts`: Vercel endpoints; scores use Neon Postgres.
- `tests/quantum-golf/`: browser-controller, solver, date, and database checks. API tests use local PGlite and need no credentials.

## Puzzles

The 15 campaign levels start at `|+⟩`. A score counts H/T presses; a hit means Bloch distance `‖r − target‖ / 2 ≤ ε`.

Daily puzzles start on 13 October 2026 and require 8–12 moves optimally. They are generated on request, with no scheduled job. Scoring closes at midnight in **Europe/Paris**, including daylight-saving changes. Past puzzles remain playable as practice, with readable rankings. The server enforces the deadline; daily scores share the existing table without changing campaign scores.
