# Game maintenance

Game logic lives in `src/lib/<game>/`; controllers and workers live in `src/scripts/`.
Shared components, controls, tutorials, daily transport, scoring and replay exports live in `src/components/games/` and `src/lib/games/`.
Browser tests are in `tests/browser/`, with shared fixtures under `tests/browser/helpers/`.
Score setup and backups are covered in [development](development.md).

## Quantum golf

Campaign levels start at `|+⟩`. Scores count H/T presses, and a hit requires Bloch distance `‖r − target‖ / 2 ≤ ε`.
`tools/quantum-golf/` contains the campaign input, Python precomputation and verification tools.
Use `npm run precompute:golf`, `npm run verify:campaign` and `npm run check:golf`.
Changing released puzzle data or seeded generation requires a new campaign or daily version.

## Circuit simplification

Rules and printed missions come from [the original PDF](../public/outreach/jeu-circuits-quantiques.pdf), pages 7–11.
Rules unlock progressively. Spacing is free; only rewrites count towards the score.

`tools/circuit-reduction/` holds offline generation, witnesses and certificates.
Runtime data contains only boards and scores. The catalogue uses every scored rule family, bounds repeated alternating CZ patterns and rejects structural duplicates.
Its diversity checks compare typed wire motifs with multiset Jaccard distance and gate-type entropy.

```sh
node tools/circuit-reduction/certify-generated.mjs --check-data
node tools/circuit-reduction/certify-generated.mjs --check
node tools/circuit-reduction/certify-generated.mjs --audit
```

`--check-data` checks derivations, diversity and rule coverage; `--check` repeats exact search; `--audit` samples random and daily puzzles.
Rebuild offline with `--generate`. Changing released catalogue data requires a new daily/generator version.
Daily optima are 10–14 moves. Named lessons and their proved or best-known bounds are defined in the puzzle data.
Custom circuits must implement identity; a bounded search reports an optimum only when proved. Interactive spacing is unbounded.
For focused browser checks, `GAME_TEST_SCOPE=custom` selects the builder and JSON exchange; `mobile` selects touch checks.

## Quantum signals

The goal is the all-ones state. A single surviving path may have either overall sign.
Fixed gates and holes can be interleaved. The expanded view uses binary order and shows positive amplitudes in black/gray and negative amplitudes in white.
The gate memo shows all input colours and bit values without interaction.

Generated puzzles constrain hole positions and gate choices to require interference; optional identity holes occur only in generated and custom puzzles.
Custom JSON contains wires and columns, without target data. Wire 0 is the leftmost bit internally; CX controls the first listed wire and XC the second.
Leaderboards record verified completions without scores or ranks.

## Circuit categories

The two circuit games default to PRO. Their Category menu adds PROP swaps and Controlled PROP control constructors.
Each advanced category has tutorials, named levels and custom/random puzzles; daily puzzles stay in PRO.
Only the selected controller loads. Both categories reuse the base games' dialogs, controls, JSON exchange, replay and Signals paths.

Rewrites preserve exact matrices, including global phase. Controlled rewrites select target gates under a shared control context.
Swaps join consecutive wires and obey involution, naturality, braid and three-CNOT equations.
Random simplification puzzles carry a checked solution witness; no optimum is claimed.
Signals targets are fixed. PROP holes offer whole gates; Controlled PROP may fix controls around a hole.
The equations are a subset of the [controlled-PROP presentation](https://arxiv.org/abs/2508.21756).

## Graph states

Puzzles belong to the numbered chain's local-Clifford orbit. Local complementation costs one shot; a pivot costs three.
A cached breadth-first search gives exact optima using local complementations, since a pivot cannot shorten that distance.
Clifford corrections are reduced independently on each wire and appear under Advanced.
Live and GIF replays share animation geometry and timing; long GIF histories are sampled to bound export work.
Custom JSON contains only `vertices` and zero-based `edges`.

## ZX simplification

The target is two identity wires. Rewrites preserve tensors up to a nonzero scalar; phases add modulo one full turn.
Random puzzles expand from the target and retain a verification solution.
Colour change absorbs Hadamards when every leg has one and adds them otherwise; one rule button chooses the direction.
The rule palette is shared with circuit simplification.

Node positions remain fixed through rewrites. Undo and replay keep layouts in memory, separately from puzzle JSON and scores.
Live play and GIFs share animation geometry; reduced motion skips live animation.
Named-level verification sequences live in `tests/fixtures/zx-calculus/solutions.json`.

## Daily puzzles

Seeds, Paris midnight, archives, outages and offline practice use the shared daily modules.
Preserve published versions and stable seeds when refactoring generators. Past puzzles remain practice after scoring closes.
Replay images are prepared on Share; GIF encoding starts only on Download.
