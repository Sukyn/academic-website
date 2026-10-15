# Quantum golf

The 15 campaign levels start at `|+⟩`. Scores count H/T presses; a hit requires Bloch distance `‖r − target‖ / 2 ≤ ε`.

Daily puzzles start on 13 October 2026 and have optimal solutions of 8–12 moves. They are generated on request. Scoring closes at midnight in Europe/Paris; past puzzles remain playable as practice.

Game logic is in `src/lib/quantum-golf/`, with the controller in `src/scripts/quantum-golf.js`. Shared game services are in `src/lib/games/`.

```sh
npm run test:golf
npm run test:games:api
```

See [SETUP.md](SETUP.md) for local API access and score backups. Tests use an isolated PGlite database without credentials.
