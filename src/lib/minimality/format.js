const greek = new Map(Object.entries({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  varepsilon: 'ε', vartheta: 'ϑ', varkappa: 'ϰ', varpi: 'ϖ',
  varrho: 'ϱ', varsigma: 'ς', varphi: 'φ',
}).flatMap(([name, symbol]) => [
  [name, symbol],
  [name[0].toUpperCase() + name.slice(1), symbol.toUpperCase()],
  [name.toUpperCase(), symbol.toUpperCase()],
]));

const shortcutNames = new Map(Object.entries({
  CNOT_zero: 'CX0', CH_zero: 'CH0', CZ_zero: 'CZ0', Z_zero: 'Z0',
  phase_T: 'pT', phase_T_dagger: 'pT_dagger', phase_T_zero: 'pT0',
}));

export const compactShortcutName = name => shortcutNames.get(name) ?? name;

const gateSymbols = new Set([...greek.values(), ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_+-−†′⁻¹']);
const suffixes = { dagger: '†', prime: '′', inv: '⁻¹' };

export function isGateLabel(label) {
  const symbols = [...label];
  return symbols.length > 0 && symbols.length <= 4 && symbols.every(symbol => gateSymbols.has(symbol));
}

export function displayName(name) {
  if (name === 'minus_one') return '−1';
  if (name === 'minus') return '−';
  return name.replace(/\\?([\p{L}\p{M}]+)/gu, (token, letters) => greek.get(letters) ?? token)
    .replace(/_(dagger|prime|inv)(?![\p{L}\p{M}\p{N}_])/gu, (_, suffix) => suffixes[suffix]);
}
