# Advanced circuits

The standard games use PROs. PROP adds swaps; Controlled PROP adds control as a constructor. All three use finite real-gate fragments. The advanced games share an engine for H, X, Z, SWAP and positive controls, with a subset of the [controlled-PROP equations](https://arxiv.org/abs/2508.21756).

Dialogs, controls, shortcuts, tutorials, replay, JSON handling and Signals paths/animations reuse the standard games' modules. Advanced code supplies the extra equations, puzzle data and editing tools.

Rewrites preserve exact matrices, including global phase. A controlled rewrite consumes whole operations while selecting their targets. Swaps join consecutive wires and obey involution, naturality and braid equations. Random simplification puzzles carry a checked solution witness; no optimum is claimed.

Signals targets are stored as reference circuits, so controlled-H needs no floating-point JSON. Fixed gates precede the holes. PROP holes offer whole gates; Controlled PROP can also fix controls around a hole.

`npm test` checks semantics and editor/rendering behavior. After building and starting a preview, run `node tools/categorical-circuits/browser.mjs` for desktop/mobile play tests.
