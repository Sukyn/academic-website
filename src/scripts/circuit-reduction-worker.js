import { solveShortest } from '../lib/circuit-reduction/engine.js';
self.onmessage = ({ data }) => {
  try {
    const { status, optimalMoves } = solveShortest(data.circuit, { maxDepth: 20, maxNodes: 250000 });
    self.postMessage({ status, optimalMoves });
  }
  catch { self.postMessage({ status: 'error' }); }
};
