# Advanced circuits

The two advanced games share one real circuit engine: H, X, Z, SWAP and positive controls. This is a finite fragment, not a complete implementation of the [controlled-PROP presentation](https://arxiv.org/abs/2508.21756).

Rewrites preserve exact matrices, including global phase. A controlled rewrite consumes whole operations while selecting their targets. Swaps obey involution, naturality and braid equations. Random simplification puzzles carry a checked solution witness; no optimum is claimed.

Signals targets are stored as reference circuits, so controlled-H needs no floating-point JSON. Fixed gates precede the holes.

`npm test` checks semantics and editor/rendering behavior. After building and starting a preview, run `node tools/categorical-circuits/browser.mjs` for desktop/mobile play tests.
