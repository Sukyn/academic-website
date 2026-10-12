import { solveShortest } from '../lib/quantum-golf/solver.js';

self.onmessage = ({ data }) => {
  try {
    const { sequence, ...result } = solveShortest(data.target, data.epsilon);
    self.postMessage(result);
  } catch {
    self.postMessage({ status: 'error' });
  }
};