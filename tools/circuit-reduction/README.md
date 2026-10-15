# Circuit reduction

Rules and printed missions come from [`jeu-circuits-quantiques.pdf`](../../public/outreach/jeu-circuits-quantiques.pdf), pages 7–11. Rules unlock progressively; custom and daily puzzles use all 20 learned rules. Identity spacing is free and unbounded. Only rewrites count towards the score.

The first 20 tutorial levels have certified shortest solutions. The last two have **Best known** solutions of 15 and 19 moves; their optima are unproved.

## Puzzle data

The generator selects precomputed circuits constructed from identity. Runtime data contains boards and scores; derivations are kept in `catalogue-witnesses.js` and `paper-witnesses.js`, with search certificates in `catalogue-certificates.json`.

```sh
node tools/circuit-reduction/certify-generated.mjs --check-data
node tools/circuit-reduction/certify-generated.mjs --check
```

`--check-data` checks scores and legal forward/reverse derivations; `--check` recertifies catalogue optima. **Changing or reordering released catalogue data requires a new daily/generator version**, because it changes seeded puzzles.

Daily puzzles start on 14 October 2026, use a frozen date/version seed and have certified optima of **10–14 moves**. Scoring follows the Europe/Paris calendar. Offline daily puzzles remain playable as practice.

Custom imports accept 16,384 characters and at most four wires. They must represent identity. A bounded exact search reports an optimum only when proved; interactive spacing remains unbounded.

Shared controls and services live in `src/components/games/`, `src/lib/games/` and `src/styles/games.css`. Both APIs accept `game=circuit-reduction`; the server replays submitted rewrites. See [score setup](../quantum-golf/SETUP.md).

## Checks

```sh
npm run test:reduction
npm run test:games:api
npm run test:reduction:browser
```

For browser checks, start `npm run dev`. Playwright must be installed or available through `PLAYWRIGHT_MODULE_DIR`; `PLAYWRIGHT_EXECUTABLE` can select installed Chrome/Edge. Set `GAME_TEST_SCOPE=mobile` for the touch checks only.

Browser checks normally use fixed ranking responses without database writes. To test submissions against an isolated PGlite database, start `node tools/circuit-reduction/test-api.mjs` and set `GAME_API_URL=http://127.0.0.1:4322` for the browser script. Set `GAME_TEST_TIME=2026-10-14T10:00:00Z` in both processes for a repeatable daily puzzle.
