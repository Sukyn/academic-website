# Quantum signals

Fill circuit holes with H, X, Z, CX, XC, CZ or identity to reach a real quantum state. Holes offering identity can stay empty. Targets match up to global sign, including relative phase.

The simulator uses at most four qubits, sixteen columns and six holes. Fixed gates prepare the input; all editable holes follow them. White wires show the circuit. The mirrored diagram uses Gray-code order: adjacent lanes differ in one bit. Black dots and dark paths mean + phase; white dots and paths mean − phase. Dot areas show probabilities. Both views scroll together; the target sits beyond a divider.

The flow model reuses the gate simulator and adds contributions before each new column, so destructive interference extinguishes paths. Target markers match up to global phase.

Twelve lessons introduce flips, interference and entanglement. Random and Paris-time daily puzzles use targets generated from a known valid filling. The daily seed/version is frozen.

In Custom/Random, use **Advanced → Edit this circuit** or **Start from scratch**. Click a circuit cell for its gate palette; connect a control, target or paired hole by clicking another wire. Target dots cycle off → black → white → off. Selected target states have equal probability. Play the draft, then use the shared JSON buttons to exchange it. Targets use signed bit labels such as `{"00":1,"11":-1}`. Wire 0 is the leftmost bit. CX controls the first listed wire; XC controls the second.

Shared menus, daily transport and lazy replay downloads use the existing game modules. Optional completion lists show players and checked boxes for levels and daily puzzles, without scores or ranks.

```sh
npm run test:signals
npm run test:signals:browser
```

Browser checks need a built preview on port 4323 and the optional tools described in [quality checks](../quality/README.md). Daily and completion requests use local fixtures; nothing is submitted to production.
