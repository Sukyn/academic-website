import assert from 'node:assert/strict';
import test from 'node:test';
import { compactShortcutName, displayName, isGateLabel } from '../src/lib/minimality/format.js';

const names = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ');

test('prints the Greek alphabet in lowercase, title case, and uppercase', () => {
  assert.equal(displayName(names.join(' ')), 'α β γ δ ϵ ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ ϕ χ ψ ω');
  assert.equal(displayName(names.map(name => name[0].toUpperCase() + name.slice(1)).join(' ')), 'Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω');
  assert.equal(displayName(names.join(' ').toUpperCase()), 'Α Β Γ Δ Ε Ζ Η Θ Ι Κ Λ Μ Ν Ξ Ο Π Ρ Σ Τ Υ Φ Χ Ψ Ω');
});

test('accepts LaTeX names and follows its epsilon and phi variant convention', () => {
  assert.equal(displayName(names.map(name => `\\${name}`).join(' ')), 'α β γ δ ϵ ζ η θ ι κ λ μ ν ξ ο π ρ σ τ υ ϕ χ ψ ω');
  assert.equal(displayName('epsilon varepsilon theta vartheta kappa varkappa pi varpi rho varrho sigma varsigma phi varphi'), 'ϵ ε θ ϑ κ ϰ π ϖ ρ ϱ σ ς ϕ φ');
  assert.equal(displayName('\\Omega \\VARPHI Vartheta'), 'Ω Φ Θ');
});

test('formats name components without inferring powers or subscripts', () => {
  assert.equal(displayName('omega8 X_alpha omega_dagger omega^8 omega_{a,b} \\omega12'), 'ω8 X_α ω† ω^8 ω_{a,b} ω12');
  assert.equal(displayName('H CNOT S_dagger X_a,b 123'), 'H CNOT S† X_a,b 123');
});

test('prints dagger suffixes while preserving literal names and longer words', () => {
  const source = 'S_dagger omega_dagger';
  assert.equal(displayName(source), 'S† ω†');
  assert.equal(source, 'S_dagger omega_dagger');
  assert.equal(displayName('S_daggered S_dagger2 S_dagger_alpha dagger'), 'S_daggered S_dagger2 S_dagger_α dagger');
});

test('preserves complete words, mixed case, Unicode, and unknown commands', () => {
  const untouched = 'alphabet omegaGate piGate megapixel signal oMeGa ALpha ω Ω α_β éomega omegá \\unknown';
  assert.equal(displayName(untouched), untouched);
  assert.equal(displayName(''), '');
});

test('returns literal strings without interpreting HTML or changing the source', () => {
  const source = '<img src=x onerror="alert(1)"> & \\unknown {H}';
  assert.equal(displayName(source), source);
  const name = 'omega8';
  assert.equal(displayName(name), 'ω8');
  assert.equal(name, 'omega8');
});

test('prints compact primes, inverses, and scalar minus labels', () => {
  assert.equal(displayName('S_prime'), 'S′');
  assert.equal(displayName('S_inv'), 'S⁻¹');
  assert.equal(displayName('omega_prime'), 'ω′');
  assert.equal(displayName('minus'), '−');
  assert.equal(displayName('minus_one'), '−1');
  assert.equal(displayName('minus_one2 S_primeval S_inv2'), 'minus_one2 S_primeval S_inv2');
});

test('gate label bounds count supported displayed symbols instead of source command lengths', () => {
  for (const raw of ['H', 'CNOT', 'X_1', 'A+B', 'A-B', 'A−B', 'omega_dagger', '\\omega', 'S_inv', 'alpha_beta',
    'varepsilon_varepsilon', 'minus_one', 'minus', 'S_prime']) {
    assert.equal(isGateLabel(displayName(raw)), true, raw);
  }
  for (const raw of ['', 'ABCDE', 'CNOT_dagger', 'H H', '<H>', '🙂', 'é', '中', '\\x', '\\unknown', 'H^2', 'H_{1}',
    'a,b', 'H/2', 'H*H', 'H\u200b', 'H\u200d', 'H\u202e', 'α\u0301', '\ud800']) {
    assert.equal(isGateLabel(displayName(raw)), false, raw);
  }
});

test('only explicit source shortcut aliases are canonicalized', () => {
  for (const [source, expected] of Object.entries({
    CH_zero: 'CH0', CNOT_zero: 'CX0', Z_zero: 'Z0', CZ_zero: 'CZ0',
    phase_T: 'pT', phase_T_dagger: 'pT_dagger', phase_T_zero: 'pT0',
  })) assert.equal(compactShortcutName(source), expected);
  for (const literal of ['H', 'CH0', 'CH_one', 'CNOT', 'minus_one', 'omega_dagger']) assert.equal(compactShortcutName(literal), literal);
});
