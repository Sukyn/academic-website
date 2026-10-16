import { getBoard as golfBoard, validateSubmission as golfSubmission } from '../quantum-golf/leaderboard.js';
import { DAILY_START as GOLF_START, dailyPuzzle as golfDaily } from '../quantum-golf/daily.js';
import { getBoard as reductionBoard, validateSubmission as reductionSubmission, MAX_SUBMISSION_BYTES as REDUCTION_BYTES } from '../circuit-reduction/leaderboard.js';
import { DAILY_START as REDUCTION_START, dailyPuzzle as reductionDaily } from '../circuit-reduction/puzzles.js';
import { DAILY_START as SIGNALS_START, dailyPuzzle as signalsDaily } from '../quantum-signals/puzzles.js';
import { getBoard as signalsBoard, validateSubmission as signalsCompletion, MAX_SUBMISSION_BYTES as SIGNALS_BYTES } from '../quantum-signals/completions.js';
import { DAILY_START as GRAPH_START, dailyPuzzle as graphDaily } from '../graph-states/puzzles.js';
import { getBoard as graphBoard, validateSubmission as graphSubmission, MAX_SUBMISSION_BYTES as GRAPH_BYTES } from '../graph-states/leaderboard.js';
import { optimalShots } from '../graph-states/engine.js';
import { MAX_SUBMISSION_BYTES, SubmissionError } from './submission.js';

// Games share transport; each validates its own score or completion record.
const games = {
  'quantum-golf': {
    getBoard: golfBoard, validateSubmission: golfSubmission,
    startDate: GOLF_START, maxBytes: MAX_SUBMISSION_BYTES,
    dailyPuzzle(date) {
      const { target, epsilon, optimalMoves } = golfDaily(date);
      return { target, epsilon, optimalMoves };
    },
  },
  'circuit-reduction': {
    getBoard: reductionBoard, validateSubmission: reductionSubmission,
    startDate: REDUCTION_START, maxBytes: REDUCTION_BYTES,
    dailyPuzzle(date) {
      const { circuit, optimalMoves } = reductionDaily(date);
      return { circuit, optimalMoves };
    },
  },
  'quantum-signals': {
    getBoard: signalsBoard, validateSubmission: signalsCompletion, completionOnly: true,
    startDate: SIGNALS_START, maxBytes: SIGNALS_BYTES,
    dailyPuzzle(date) {
      const { wires, columns, target } = signalsDaily(date);
      return { wires, columns, target };
    },
  },
  'graph-states': {
    getBoard: graphBoard, validateSubmission: graphSubmission,
    startDate: GRAPH_START, maxBytes: GRAPH_BYTES,
    dailyPuzzle(date) {
      const graph = graphDaily(date), { vertices, edges } = graph;
      return { vertices, edges, optimalMoves: optimalShots(graph) };
    },
  },
};

export function getGame(value = 'quantum-golf') {
  if (typeof value !== 'string' || !Object.hasOwn(games, value)) {
    throw new SubmissionError('Choose a supported game.');
  }
  return games[value];
}
