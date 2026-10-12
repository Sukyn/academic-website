"""Rebuild browser-port oracles using the repository's production Python code.

Run from any directory with Python and dependencies from requirements.txt.
The repository-local .python_deps directory is used when present.
Output files are compact JSON and contain no generated timestamps.
"""

from pathlib import Path
import argparse
import hashlib
import json
import random
import sys

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-root", type=Path, default=HERE.parents[1],
                    help="Path to the source repository containing python_algorithms")
parser.add_argument("--output-dir", type=Path, default=HERE,
                    help="Directory for fields.json and references.json")
args = parser.parse_args()
ROOT = args.source_root.resolve()
OUTPUT = args.output_dir.resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))
if (ROOT / ".python_deps").is_dir():
    sys.path.insert(0, str(ROOT / ".python_deps"))

from sympy import factorint
from python_algorithms.algorithms_count import construction, count_tables
from python_algorithms.algorithms_to_circuits import generate_circuit
from python_algorithms.utils import ALGORITHMS, field, max_degree


def write_json(name, value):
    path = OUTPUT / name
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {name}: {path.stat().st_size:,} bytes", flush=True)


def main():
    fields = {}
    for q in range(5, 257):
        factors = factorint(q)
        if len(factors) != 1 or min(factors) < 5:
            continue
        K = field(q)
        metadata = {"characteristic": int(K.characteristic), "primitive": int(K.primitive_element)}
        if K.degree > 1:
            metadata["modulus"] = K.irreducible_poly.coeffs.tolist()
        fields[str(q)] = metadata
    write_json("fields.json", fields)

    candidates = []
    depths = [0, 1, 2, 3, None]
    ks = [1, 2, 3, 5, 8, 10]
    for qi, q in enumerate([5, 7, 11, 25, 49, 125]):
        for ai, algorithm in enumerate(ALGORITHMS):
            if algorithm == "simple_polarization":
                degrees = [1, 2, max(k for k in ks if k <= max_degree(q))]
            else:
                degrees = [ks[(qi + ai + 2 * ci) % len(ks)] for ci in range(3)]
            for ci, k in enumerate(degrees):
                depth = depths[(qi + ai + ci) % len(depths)]
                borrowed = [0, 1, 3][ci] if algorithm == "borrow-and-conquer" else 0
                candidates.append((q, k, algorithm, depth, borrowed))

    # Two externally borrowed wires let the mixed recurrence choose a ladder.
    # Borrow also exercises the internal binary borrowed ladder wrapper.
    candidates.extend([
        (5, 8, "borrow-and-conquer", 1, 1),
        (5, 8, "borrow-and-conquer", None, 1),
        (5, 16, "borrow-and-conquer", 2, 2),
        (5, 16, "borrow-and-conquer", None, 2),
        (7, 16, "borrow-and-conquer", None, 3),
        (11, 20, "borrow-and-conquer", 2, 4),
        (5, 20, "borrow", None, 0),
        (7, 20, "divide-and-conquer", 3, 0),
    ])
    fixtures = []
    arithmetic_tables = {}
    for q, k, algorithm, max_rec, borrowed in candidates:
        # Simple-polarization's admissible range is checked independently.
        assert algorithm != "simple_polarization" or k <= max_degree(q)
        if max_rec is None:
            tables = count_tables(q, k, borrowed, algorithm)
            if construction(tables, k, borrowed, algorithm)[0] > 12000:
                max_rec = 1
        circuit = generate_circuit(q, k, algorithm, max_rec, borrowed)
        if len(circuit["operations"]) > 12000:
            # Retain an expensive scenario with a useful bounded expansion.
            max_rec = 1
            circuit = generate_circuit(q, k, algorithm, max_rec, borrowed)
        assert len(circuit["operations"]) <= 12000
        K = field(q)
        if q not in arithmetic_tables:
            elements = K.elements
            arithmetic_tables[q] = ((elements[:, None] + elements[None, :]).tolist(),
                                    (elements[:, None] * elements[None, :]).tolist())
        addition, multiplication = arithmetic_tables[q]
        rng = random.Random(f"{q}/{k}/{algorithm}/{max_rec}/{borrowed}")
        inputs = [[q - 1] * circuit["wire_count"],
                  [rng.randrange(1, q) for _ in range(circuit["wire_count"])],
                  [0] + [rng.randrange(q) for _ in range(circuit["wire_count"] - 1)]]
        examples = []
        for values in inputs:
            expected = list(values)
            increment = K(1)
            for value in values[:k]:
                increment *= K(value)
            expected[k] = int(K(values[k]) + increment)
            state = list(values)
            for gate in circuit["operations"]:
                if gate["op"] == "add":
                    increment = gate["coefficient"]
                    for control in gate["controls"]:
                        increment = multiplication[increment][state[control]]
                    target = gate["target"]
                    state[target] = addition[state[target]][increment]
                elif gate["op"] == "scale":
                    wire = gate["wire"]
                    state[wire] = multiplication[state[wire]][gate["coefficient"]]
                elif gate["op"] == "swap":
                    wire = gate["wire"]
                    if state[wire] == gate["a"]:
                        state[wire] = gate["b"]
                    elif state[wire] == gate["b"]:
                        state[wire] = gate["a"]
                else:
                    raise AssertionError(gate)
            assert state == expected, (q, k, algorithm, max_rec, borrowed, values)
            examples.append({"input": values, "output": expected})
        fixtures.append({"q": q, "k": k, "algorithm": algorithm,
                         "max_rec": max_rec, "borrowed": borrowed, "circuit": circuit,
                         "examples": examples})
        print(f"{len(fixtures):2}: q={q}, k={k}, {algorithm}, depth={max_rec}, b={borrowed}: "
              f"{len(circuit['operations'])} operations", flush=True)
    references = []
    for fixture in fixtures:
        circuit = fixture["circuit"]
        canonical = json.dumps(circuit, separators=(",", ":")).encode("utf-8")
        references.append({key: fixture[key] for key in ("q", "k", "algorithm", "max_rec", "borrowed")}
                          | {"sha256": hashlib.sha256(canonical).hexdigest(),
                             "gate_count": len(circuit["operations"]), "examples": fixture["examples"]})
    write_json("references.json", references)
    print(f"Fields: {len(fields)}. Cases: {len(fixtures)}. "
          f"Total operations: {sum(len(f['circuit']['operations']) for f in fixtures):,}.", flush=True)


if __name__ == "__main__":
    main()
