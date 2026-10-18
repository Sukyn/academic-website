/** Cache only the latest result for an immutable puzzle and its current placements. */
export function createPuzzleResult(evaluate) {
  let previousPuzzle, previousPlacements, result;
  return (puzzle, placements) => {
    if (previousPuzzle !== puzzle || previousPlacements !== placements) {
      result = evaluate(puzzle, placements);
      previousPuzzle = puzzle; previousPlacements = placements;
    }
    return result;
  };
}
