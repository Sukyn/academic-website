"""Compute the fixed campaign with standard-library Python; --check never writes."""
import argparse
import json
import math
from pathlib import Path
import sys

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent.parent
HALF = math.sqrt(0.5)
PHASE = complex(HALF, HALF)


def shortest(level):
    """Search by length with O(depth) memory and independent complex amplitudes.

    HH and T^8 are identities, so neither can occur in a shortest word.
    No states are rounded, merged or discarded based on their distance.
    """
    target, epsilon = level["target"], level["epsilon"]
    if not (0 < epsilon < 1 and len(target) == 3
            and all(math.isfinite(x) for x in target)
            and math.isclose(math.hypot(*target), 1, rel_tol=0, abs_tol=1e-12)):
        raise ValueError(f"Invalid hole: {level['id']}")
    boundary = False

    def visit(a, b, remaining, t_run, first=False):
        nonlocal boundary
        if remaining == 0:
            overlap = a.conjugate() * b
            norm = abs(a) ** 2 + abs(b) ** 2
            point = (2 * overlap.real / norm, 2 * overlap.imag / norm,
                     (abs(a) ** 2 - abs(b) ** 2) / norm)
            distance = math.dist(point, target) / 2
            if distance < epsilon - 1e-12:
                return True
            boundary |= abs(distance - epsilon) <= 1e-12
            return False
        if (first or t_run > 0) and visit(
                (a + b) * HALF, (a - b) * HALF, remaining - 1, 0):
            return True
        return t_run < 7 and visit(a, b * PHASE, remaining - 1, t_run + 1)

    for depth in range(33):
        if visit(HALF + 0j, HALF + 0j, depth, 0, first=True):
            return depth
        if boundary:
            raise ValueError(f"Level {level['id']} needs higher boundary precision")
    raise ValueError(f"No solution through 32 moves for level {level['id']}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="recompute and compare without changing files")
    args = parser.parse_args()
    campaign = json.loads((TOOLS / "campaign.json").read_text(encoding="utf-8"))
    if not campaign["levels"] or [level["id"] for level in campaign["levels"]] != list(range(1, len(campaign["levels"]) + 1)):
        raise ValueError("Campaign level IDs must start at 1 and be consecutive")
    levels = [{**{key: level[key] for key in ("id", "title", "target", "epsilon")},
               "optimalMoves": shortest(level)} for level in campaign["levels"]]
    server = {"version": campaign["version"], "levels": [
        {key: level[key] for key in ("id", "target", "epsilon", "optimalMoves")}
        for level in levels
    ]}
    outputs = {
        ROOT / "src/lib/quantum-golf/levels.json": levels,
        ROOT / "src/lib/quantum-golf/campaign.json": server,
    }
    for output, data in outputs.items():
        if args.check:
            if not output.exists() or json.loads(output.read_text(encoding="utf-8")) != data:
                raise ValueError(f"Stale campaign data: {output}; run npm run precompute:golf")
        else:
            output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("Shortest H+T counts:", ", ".join(str(level["optimalMoves"]) for level in levels))
    print("Checked both generated files." if args.check else "Wrote both generated files.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(str(error))
