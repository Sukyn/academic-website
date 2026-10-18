# Circuit categories

The Category menu selects PRO (default), PROP (swaps), or Controlled PROP (control as a constructor) on each game's main page. Only the selected controller loads. All three use finite real-gate fragments, with a subset of the [controlled-PROP equations](https://arxiv.org/abs/2508.21756).

PROP and Controlled PROP have separate tutorials, named levels with leaderboards, and custom/random puzzles. Daily puzzles remain in PRO. Dialogs, controls, shortcuts, replay, JSON handling and Signals paths/animations use the shared game modules.

Rewrites preserve exact matrices, including global phase. A controlled rewrite consumes whole operations while selecting their targets. Swaps join consecutive wires and obey involution, naturality, braid and three-CNOT equations. Random simplification puzzles carry a checked solution witness; no optimum is claimed.

Signals targets are stored as reference circuits, so controlled-H needs no floating-point JSON. Fixed gates precede the holes. PROP holes offer whole gates; Controlled PROP can also fix controls around a hole.

`npm test` checks semantics and editor/rendering behavior. After building and starting a preview, run `node tools/categorical-circuits/browser.mjs` for desktop/mobile play tests.
