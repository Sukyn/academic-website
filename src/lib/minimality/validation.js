import { compactShortcutName, displayName, isGateLabel } from './format.js';

export function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  return value;
}

export function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new RangeError(`${label} must be a list with at most ${maximum} entries.`);
  return value;
}

export function tuple(value, minimum, maximum, label) {
  list(value, maximum, label);
  if (value.length < minimum) throw new RangeError(`${label} must contain at least ${minimum} entries.`);
  return value;
}

export function name(value, label, limit) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new RangeError(`${label} must be text without control characters.`);
  const result = value.trim();
  if (!result || [...result].length > limit) throw new RangeError(`${label} must contain 1–${limit} characters.`);
  return result;
}

export function gateLabel(value, label, limit, shortcut = false) {
  const raw = name(value, label, limit);
  const canonical = shortcut ? compactShortcutName(raw) : raw;
  const display = displayName(canonical);
  if (!isGateLabel(display)) {
    throw new RangeError(`${label} must render as 1–4 Latin or Greek letters, digits, or supported symbols. Use a short label such as CH0, omega, or S_dagger.`);
  }
  return { name: canonical, display };
}

export function parseJSON(source, byteLimit, label) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > byteLimit) {
    throw new RangeError(`${label} must be JSON text within ${byteLimit / 1000} KB.`);
  }
  try { return JSON.parse(source); }
  catch { throw new RangeError(`${label} is not valid JSON.`); }
}
