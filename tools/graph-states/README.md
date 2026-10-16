# Graph states

Restore the numbered chain by clicking vertices for local complementation (1 shot). Clicking an edge performs a pivot (3 shots). Advanced shows the accumulated Clifford corrections.

Levels, random puzzles and daily puzzles use the chain's local-Clifford orbit, so every puzzle is reachable. Custom graphs start from a chain; JSON contains only `vertices` and zero-based `edges`.

Optimal shots are exact: a cached breadth-first search uses local complementations, since a pivot costs the same as its three component moves.

`npm run test:graphs` checks graph operations, quantum-state equivalence and puzzle validation. `npm run test:graphs:browser` checks mouse/touch play on a built preview at port 4323, using local API fixtures.
