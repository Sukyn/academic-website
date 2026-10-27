/** Cache only the latest evaluation of immutable puzzle data and optional placements. */
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
