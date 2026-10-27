# Quantum signals

Fill circuit holes with H, X, Z, CX, XC, CZ or identity to collect every path at the all-ones label. Holes offering identity can stay empty. A single surviving path may have either overall sign.

The simulator uses at most four qubits, sixteen columns and six holes. Fixed gates and holes can be interleaved. White wires show the circuit; expanded paths use binary order. Black dots and gray paths mean + phase; white dots and paths mean − phase. Matching signs add and opposite signs cancel. The goal is a gold ring beyond the divider.

The tutorial uses three worked circuits to explain bits, amplitudes, interference and controls. It begins with empty wires, then introduces imposed gates. Next plays each action; Restart resets the tutorial. On mobile, each step shows the relevant circuit or expanded paths. The gate memo uses fixed basis lanes and marks routes that swap the incoming colour.

Twelve levels introduce flips, interference and entanglement. Later levels, random puzzles and Paris-time daily puzzles use graph-state preparation, phase choices and leaf-by-leaf recombination. Their imposed final Hadamard requires coherent amplitudes at the finish. Hole positions and offered gates are constrained; every generated solution needs H and Z, plus a controlled gate for two or three qubits. Optional empty holes occur only in generated and custom puzzles.

In Custom/Random, use **Advanced → Edit this circuit** or **Start from scratch**. Select a cell, then connect paired gates on another wire. JSON contains only wires and columns, without target data. Wire 0 is the leftmost bit internally. CX controls the first listed wire; XC controls the second.

Shared menus, daily transport and lazy replay downloads use the existing game modules. Optional completion lists show players and checked boxes for levels and daily puzzles, without scores or ranks.

```sh
npm run test:signals
npm run test:signals:browser
```

Browser checks need a built preview on port 4323 and the optional tools described in [quality checks](../quality/README.md). Daily and completion requests use local fixtures; nothing is submitted to production.
