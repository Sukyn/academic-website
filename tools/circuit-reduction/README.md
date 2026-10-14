# Circuit reduction

Play at `/games/circuit-reduction/`. This is the circuit-simplification game underlying *Les chevaliers du quantique*, without its game-jam story. The 22 tutorial levels include all 16 printed missions, the alternative board for mission 4, two first steps and three focused introductions to advanced rules.

## Rules and sources

The rule patterns come from `public/outreach/jeu-circuits-quantiques.pdf` (pages 7–11). Every rule is reversible. Patterns match a complete rectangular selection, including empty slots. Click or tap a wire gap to insert identity space; Shift-click inserts a column on all wires. Right-click an empty slot to remove it, or hold it on a touch screen. Right-clicking a gap removes the preceding identity. Linked gates stay aligned by propagating necessary shifts. There is no horizontal game limit. **Tidy** compacts every wire while preserving its gate order and connections. All layout edits and moving gates through empty space are free; only rewrites count towards the score.

Rules unlock per lesson. The PDF's basic entanglement rule cancels lower-target CNOT pairs; the player first derives phase-pair and CZ-pair cancellation using H conjugation. Following the paper's permission to reuse solved identities, later lessons unlock the small learned shortcuts HXH = Z, ZZ = identity, CZ pairs and upper-target CNOT pairs. The initial proof lessons exclude those shortcuts. Random and daily puzzles use the complete 20-rule learned set; the server also enforces each tutorial's unlocks.

The first 20 tutorial levels have certified shortest rewrite counts. The final two printed missions have legal, independently replayed solutions of 15 and 19 rewrites; their benchmarks are labelled **Best known**, since a bounded search did not establish their optima.

The design follows [Patrick Traynor's puzzle-level strategies](https://cwpat.me/misc/puzzle-level-idea-strategies/) and [Brett Taylor's GDC talk](https://media.gdcvault.com/gdc2019/presentations/Taylor_Brett_PuzzleGameMagic.pdf): teach a focused technique before combining mechanics, make harder puzzles require an insight rather than more repetitive work, and remove visual noise. SVG gate shapes and a separate connector layer also keep X targets and control links unambiguous.

## Shared features

Both games use `src/components/games/`, `src/styles/games.css`, and `src/lib/games/` for mode navigation, level controls, rules/results/share overlays, daily calendars and archives, ranking rendering, HTTP errors, abortable GIF workers, GIF downloads and clipboard images. Browsers that cannot copy a GIF can copy the final replay frame as a PNG.

The shared modules have small, separate responsibilities:

- `daily-session.js` owns requests, cancellation, the server clock, archive updates and retries. Each controller installs the puzzle without replacing an ongoing round during a refresh.
- `daily-calendar.js` builds daily metadata for the API, offline play and test fixtures; `daily-ui.js` binds the common daily controls.
- `scoreboard.js` owns score loading/submission, player state and stale-response protection. Each game supplies its selector, benchmark and submission eligibility.
- `replay-gif.js` owns worker transport, progress, PNG previews and cleanup; each worker draws its own game.
- `server.js` selects each game's validator and minimal public daily-puzzle fields for both API routes.

The controllers keep their own gameplay and replay presentation. Circuit history reuses immutable move results, and rule matching inspects only the selected window. The solver precomputes constant rule descriptors; GIF export retains only the frames it will render. These modules use browser and JavaScript platform APIs, with no new dependencies.

Custom search workers return only status and optimum. API test loading is shared in `tools/games/api-fixture.mjs`; database transport substitution is asserted before a handler can run.

`/api/daily` and `/api/leaderboard` accept `game=circuit-reduction`; omitting the game still selects Golf. Circuit submissions include `sequence: [{ rule, row, column }, ...]`, and the server replays every move from the canonical puzzle before accepting a score. Separate campaign/version keys isolate each game in the existing `scores` table; no schema migration is required. The existing [score database setup](../quantum-golf/SETUP.md) applies to both games.

## Generation and exact difficulty

Hard circuits are constructed from identity offline by reversing certified simplification sequences. `src/lib/circuit-reduction/generator.js` selects a precomputed board and score, so the browser and API neither load solutions nor rebuild intermediate derivation states. A seeded choice can reflect its wires, endpoints and rules. Wire reflection is a cost-preserving symmetry of the full learned rule set. Initial layouts are compact; padding does not manufacture difficulty. The tools-only `witnesses.js` adapter uses the same generator with its offline witnesses to verify the identical transformations.

The catalogue contains 60 distinct constructions, including 8 circuits at 10 moves and 10 circuits at each of 11–14 moves. Reflection provides 16–20 structural variants at each hard difficulty. Their shortest solutions combine overlapping-control commutation, H conjugation and phase propagation. Their optima exceed the gate-count lower bound by two moves, so cancelling gate pairs greedily does not solve them optimally. Exact-search ablation tests verify that the ten-move example needs both control commutation and H conjugation to attain its optimum.

`tools/circuit-reduction/certify-generated.mjs` constructs and certifies the catalogue offline with all 20 learned rules and free identity spacing. Complete iterative-deepening search proves that no shorter solution exists; the recorded solution is also replayed forwards and backwards. Runtime data stores only starting boards and precomputed scores. Readable `[rule, row, column]` witnesses and their arrangement wire strings live in `tools/circuit-reduction/catalogue-witnesses.js` and `paper-witnesses.js`; shared rule provenance and search-node counts live in `catalogue-certificates.json`. The certifier writes runtime boards, scores and offline witnesses from the same search results. Run `node tools/circuit-reduction/certify-generated.mjs --check-data` for a fast check of scores and legal forward/reverse derivations, or `--check` to independently recertify every catalogue optimum. Regenerating or reordering the catalogue changes seeded puzzles and therefore requires a new daily/generator version after release.

Small difficulties and explicit one/two-wire generator requests use bound-certified reverse growth. The admissible bound is `ceil(single-wire gates / 2) + ceil(linked gates / 2)`: no rule removes both gate categories, and none removes more than two gates of either category. This fallback prefers basis changes and phase propagation over bare pair insertion.

Daily puzzles start on **14 October 2026**, use a frozen date/version seed, and have a certified optimum of **10–14 moves**. Score deadlines and archives use the same Paris calendar as Golf, including daylight-saving transitions. When the API is unavailable, the identical seeded daily puzzle remains playable as offline practice; no scores can be submitted without server authorization.

Custom circuits are parsed and independently checked as identity matrices on up to four wires. A worker runs bounded exact iterative-deepening search for their optimum. If the search exhausts its budget, the interface reports that the optimum is undetermined; it does not label a greedy result as optimal.

## Checks

```sh
npm run test:reduction
npm run test:games:api
npm test
npm run check
npm run build
```

The tests independently evaluate every rewrite as a quantum matrix, replay campaign/generated witnesses, certify hundreds of random and daily circuits, and verify server score isolation, replay validation, calendar boundaries and payload limits. Browser verification should cover mouse/touch selection, gaps, reversible expansion, padding, undo/reset, replay inspection, daily practice/archives, and GIF export, along with Golf regression coverage.

For repeatable desktop/mobile browser checks, start `npm run dev` and run `npm run test:reduction:browser`. The browser script needs Playwright, either installed locally or located with `PLAYWRIGHT_MODULE_DIR`; set `PLAYWRIGHT_EXECUTABLE` when using an installed Chrome/Edge instead of Playwright's downloaded Chromium. It checks all 22 campaign levels, progressive rule visibility, direct gap clicks and taps, right-click and touch-hold removal, free wire spacing and Tidy, custom-circuit validation/search, replay and export, responsive layouts at 320/390/768/1440 pixels, and Golf on desktop/mobile.

By default, browser checks use canonical daily puzzles and the actual replay validators with fixed test ranking responses. This tests the frontend without a database or score writes; `npm run test:games:api` covers the real ranking SQL separately.

To include real API/database submission checks without production writes, start `node tools/circuit-reduction/test-api.mjs` in another terminal and set `GAME_API_URL=http://127.0.0.1:4322` for the browser script. Both processes can use the same `GAME_TEST_TIME=2026-10-14T10:00:00Z` to reproduce the launch-day puzzle. The harness loads the actual API handlers and substitutes an isolated in-memory PGlite database, including its scoring clock.

Set `GAME_TEST_SCOPE=mobile` to repeat the touch playthrough independently after a mobile-only change.
