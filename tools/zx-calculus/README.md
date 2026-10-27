# ZX simplification

The target is two identity wires. Diagrams are bounded multigraphs. Spider phases use filled quarter turns: fusion adds turns modulo one full turn. Rules preserve tensors up to a nonzero scalar. Random puzzles are expanded from the target and retain a solution for verification.

Select a wire to insert an identity spider or Hadamard pair; select spiders for the other rules. Colour change always adds a Hadamard on every incident edge; HH removes pairs. Other equations work both ways. Rule buttons share their matching and enabled states with circuit simplification; score validation checks the allowed rule family.

Node positions stay fixed through rewrites; dragging updates the existing SVG. Positions are kept in memory for undo and replays, separate from puzzle JSON and scores. Live play and GIFs share animation geometry; reduced-motion preferences skip live motion.

`npm run test:zx` checks rewrites against an independent tensor contraction and exercises the score API with an isolated PostgreSQL database. `npm run test:zx:browser` checks tutorials, levels, editing, daily play and replay export on desktop and mobile against a running preview at port 4323. Browser checks use local score fixtures.
