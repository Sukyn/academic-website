// Trusted callers validate gates and wire masks before evolving a state vector.
export function applyRealGate(state, gate, targetMask, controlMask = 0, secondMask = 0) {
  if (gate === 'I') return state;
  for (let index = 0; index < state.length; index++) {
    if ((index & controlMask) !== controlMask) continue;
    if (gate === 'Z') {
      if (index & targetMask) state[index] *= -1;
    } else if (gate === 'SWAP') {
      if (!(index & targetMask) && (index & secondMask)) {
        const other = index ^ targetMask ^ secondMask, value = state[index];
        state[index] = state[other]; state[other] = value;
      }
    } else if (!(index & targetMask)) {
      const other = index | targetMask, a = state[index], b = state[other];
      state[index] = gate === 'H' ? (a + b) * Math.SQRT1_2 : b;
      state[other] = gate === 'H' ? (a - b) * Math.SQRT1_2 : a;
    }
  }
  return state;
}
