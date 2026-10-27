import { applyMove, isSolved, moveCost } from './engine.js';
import { getLevels, signalsSolved } from './puzzles.js';
import { checkSubmissionSize, scoreName, SubmissionError } from '../games/submission.js';

export const MAX_REPLAY_MOVES = 1_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Advanced games use the same score/completion transport as the standard games. */
export function createLevelLeaderboard(kind, profile) {
  const levels = getLevels(profile, kind), signals = kind === 'signals';
  const game = `${signals ? 'quantum-signals' : 'circuit-reduction'}-${profile}`;
  // Bump the campaign version when changing or reordering official levels.
  const campaign = `${game}-levels-v${signals ? 3 : 1}`, maxBytes = signals ? 8_000 : 128_000;

  function getBoard(selector) {
    if (!object(selector) || Object.hasOwn(selector, 'date')) throw new SubmissionError('Choose a campaign level.');
    const level = typeof selector.level === 'string' || typeof selector.level === 'number' ? Number(selector.level) : NaN;
    if (!Number.isSafeInteger(level) || level < 1 || level > levels.length) {
      throw new SubmissionError(`Choose a campaign level from 1 to ${levels.length}.`);
    }
    return { campaign, level, puzzle: levels[level - 1] };
  }

  function validateSubmission(input) {
    if (!object(input)) throw new SubmissionError('Expected a level submission.');
    checkSubmissionSize(input, maxBytes, 'Expected a level submission.');
    if (Object.keys(input).some(key => !['game', 'level', 'name', 'sequence'].includes(key)) ||
        (Object.hasOwn(input, 'game') && input.game !== game)) throw new SubmissionError('Submit only this campaign level.');
    const board = getBoard(input), name = scoreName(input.name), sequence = input.sequence;
    if (!Array.isArray(sequence) || sequence.length > (signals ? board.puzzle.holes.length : MAX_REPLAY_MOVES)) {
      throw new SubmissionError('Use a bounded level replay.');
    }
    if (signals) {
      const placements = [], used = new Set();
      for (const move of sequence) {
        if (!object(move) || Object.keys(move).some(key => !['hole', 'gate'].includes(key)) ||
            !Number.isInteger(move.hole) || move.hole < 0 || move.hole >= board.puzzle.holes.length ||
            used.has(move.hole) || !board.puzzle.holes[move.hole].choices.includes(move.gate)) {
          throw new SubmissionError('Choose an offered gate for each hole.');
        }
        used.add(move.hole); placements[move.hole] = move.gate;
      }
      if (!signalsSolved(board.puzzle, placements, profile)) throw new SubmissionError('Match the target with the offered gates.');
      return { campaign, level: board.level, name };
    }
    let circuit = board.puzzle.circuit, moves = 0, work = 0;
    try {
      for (const move of sequence) {
        if (!object(move) || Object.keys(move).some(key => !['rule', 'column', 'wires', 'controls', 'reverse', 'count'].includes(key)) ||
            (Object.hasOwn(move, 'reverse') && typeof move.reverse !== 'boolean')) throw new Error('Invalid move.');
        // Circuits are capped at 48 columns, four wires and 96 operations by
        // applyMove. Bound the accumulated replay work as well as its length.
        if ((work += circuit.columns.length * circuit.wires + circuit.columns.reduce((sum, column) => sum + column.length, 0)) > 120_000) {
          throw new Error('Replay processing budget exceeded.');
        }
        circuit = applyMove(circuit, move, { profile });
        moves += moveCost(move);
      }
    } catch {
      throw new SubmissionError('That replay contains an illegal circuit rule.');
    }
    if (!moves || !isSolved(circuit)) throw new SubmissionError('Reduce this level to the identity.');
    return { campaign, level: board.level, name, moves };
  }

  return { getBoard, validateSubmission, maxBytes, ...(signals ? { completionOnly: true } : {}) };
}
