import { solveShortest } from '../lib/quantum-golf/solver.js';

self.onmessage = ({ data }) => {
  try {
    const { status, optimalMoves, checkedDepth } = solveShortest(data.target, data.epsilon);
    self.postMessage({ status, optimalMoves, checkedDepth });
  } catch {
    self.postMessage({ status: 'error' });
  }
};