# Circuit simplification

Rules and printed missions come from [`jeu-circuits-quantiques.pdf`](../../public/outreach/jeu-circuits-quantiques.pdf), pages 7–11. Rules unlock progressively; custom and daily puzzles use all 20 learned rules. Identity spacing is free and unbounded. Only rewrites count towards the score.

The first 20 campaign levels have certified shortest solutions. The last two have **Best known** solutions of 15 and 19 moves; their optima are unproved.

## Puzzle data

The generator selects precomputed identity circuits built from the full rule set. Offline construction mixes rule equations, H conjugation and reversible rewrites, then certifies the shortest solution. Runtime data contains only boards and scores; witnesses and search certificates stay in `tools/`.

```sh
node tools/circuit-reduction/certify-generated.mjs --check-data
node tools/circuit-reduction/certify-generated.mjs --check
node tools/circuit-reduction/certify-generated.mjs --audit
```

`--check-data` verifies derivations, diversity and rule coverage; `--check` repeats exact search; `--audit` samples 1,000 random and 365 daily puzzles. Rebuild offline with `--generate`. **Changing released catalogue data requires a new daily/generator version.**

Metrics ignore spacing, wire names and reversal. Alternating CZ runs are capped at four gates. The catalogue rejects structural duplicates and requires a multiset Jaccard distance of at least 0.2 between typed wire motifs (one to three gates); gate-type entropy is an additional mix check. No advanced rule family appears in more than two thirds of a hard difficulty's puzzles. Certified solutions collectively use every scored rule; free slides are handled by layout freedom.

Daily puzzles have certified optima of **10–14 moves**. The series starts on 17 October 2026, and each shuffled cycle contains 60 distinct hard structures. Consecutive days never repeat, including at cycle boundaries. Earlier dates are unavailable; completed days in this series remain available for practice. Paris midnight and offline practice follow the shared daily rules.

Create a custom circuit from identity using the same reversible rules, then play it. The shared JSON buttons exchange circuits with at most four wires; imports must implement identity. Construction history is discarded when play starts. A bounded exact search reports an optimum only when proved; interactive spacing remains unbounded. Daily puzzles hide custom controls.

Shared controls and services live in `src/components/games/`, `src/lib/games/` and `src/styles/games.css`. Both APIs accept `game=circuit-reduction`; the server replays submitted rewrites. See [score setup](../quantum-golf/SETUP.md).

## Checks

```sh
npm run test:reduction
npm run test:games:api
npm run test:reduction:browser
```

For browser checks, start `npm run dev`. Playwright must be installed or available through `PLAYWRIGHT_MODULE_DIR`; `PLAYWRIGHT_EXECUTABLE` can select installed Chrome/Edge. `GAME_TEST_SCOPE=custom` checks the builder and JSON exchange; `mobile` runs touch checks only.

Browser checks normally use fixed ranking responses without database writes. To test submissions against an isolated PGlite database, start `node tools/circuit-reduction/test-api.mjs` and set `GAME_API_URL=http://127.0.0.1:4322` for the browser script. Set `GAME_TEST_TIME=2026-10-17T10:00:00Z` in both processes for a repeatable daily puzzle.
