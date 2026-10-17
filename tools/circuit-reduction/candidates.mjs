// Offline candidate construction only. Difficulty is established by the exact
// certifier, never by the recipe's move estimate or the random walk length.
import {
  EMPTY, RULES, LEARNED_RULE_IDS, circuitKey, compactCircuit, getRewriteMoves,
  lowerBound, seededRandom,
} from '../../src/lib/circuit-reduction/engine.js';

const join = (a, b) => a.map((row, wire) => [...row, ...b[wire]]);
const reverse = circuit => circuit.map(row => [...row].reverse());
const reflectedCells = { ZU: 'ZD', ZD: 'ZU', XU: 'XD', XD: 'XU' };
const reflect = circuit => [...circuit].reverse().map(row => row.map(cell => reflectedCells[cell] || cell));
const pad = (circuit, offset) => Array.from({ length: 3 }, (_, row) =>
  circuit[row - offset] ? [...circuit[row - offset]] : Array(circuit[0].length).fill(EMPTY));

// Basis and phase patterns describe one endpoint of a linked gate. Supply the
// untouched Z endpoint on the neighbouring wire before treating them as boards.
function complete(pattern) {
  const above = pattern[0].some(cell => cell.endsWith('D')) ? 1 : 0;
  const below = pattern.at(-1).some(cell => cell.endsWith('U')) ? 1 : 0;
  const rows = Array.from({ length: above + pattern.length + below }, (_, row) =>
    pattern[row - above] ? [...pattern[row - above]] : Array(pattern[0].length).fill(EMPTY));
  for (let row = 0; row < rows.length; row++) for (let column = 0; column < rows[0].length; column++) {
    const cell = rows[row][column];
    if (cell.endsWith('U') && !rows[row + 1]?.[column].endsWith('D')) rows[row + 1][column] = 'ZD';
    if (cell.endsWith('D') && !rows[row - 1]?.[column].endsWith('U')) rows[row - 1][column] = 'ZU';
  }
  return rows;
}

// Every gate is self-inverse, so L followed by reverse(R) is identity for L=R.
// This derives a source motif from every scored rule, including the advanced
// transfer/corner/phase rules. Free slides are represented by layout freedom.
const relators = new Map(RULES.filter(rule => !rule.id.startsWith('slide-')).map(rule => {
  const circuit = compactCircuit(join(complete(rule.left), reverse(complete(rule.right))));
  const detour = /^(phase-|corner-|transfer$|control-order$)/.test(rule.id) ? 1 : 0;
  return [rule.id, { circuit, estimate: lowerBound(circuit) + detour }];
}));

// Different combinations produce genuinely different dependency structures;
// their orientation, placement, order, and subsequent rewrites vary by seed.
const families = [
  ['stabilizer', 'transfer'],
  ['stabilizer', 'corner'],
  ['transfer', 'corner'],
  ['control-order', 'transfer'],
  ['phase', 'transfer', 'corner'],
  ['stabilizer', 'corner', 'phase'],
  ['stabilizer', 'stabilizer', 'transfer'],
  ['control-order', 'corner'],
  ['phase', 'stabilizer', 'transfer'],
  ['phase', 'phase', 'transfer'],
  ['transfer', 'corner', 'corner'],
  null,
];
const ruleWeight = id => id.startsWith('basis-') ? 12
  : id.startsWith('stabilizer-') ? 5
    : /^(phase-|corner-|transfer$|control-order$)/.test(id) ? 4 : .2;

function pickWeighted(options, random) {
  // Weight rule families before their windows: many empty insertion windows
  // should not drown out a single useful phase, basis, or stabilizer rewrite.
  const byRule = new Map();
  for (const option of options) {
    if (!byRule.has(option.move.rule)) byRule.set(option.move.rule, []);
    byRule.get(option.move.rule).push(option);
  }
  const ids = [...byRule.keys()];
  let weight = random() * ids.reduce((sum, id) => sum + ruleWeight(id), 0);
  const id = ids.find(id => (weight -= ruleWeight(id)) < 0) || ids.at(-1);
  const windows = byRule.get(id);
  return windows[Math.floor(random() * windows.length)];
}

function smallRecipe(ids, difficulty, random) {
  const count = 1 + Math.floor(random() * Math.min(3, difficulty));
  let remaining = difficulty;
  return Array.from({ length: count }, (_, index) => {
    const options = ids.filter(id => relators.get(id).estimate <= remaining - (count - index - 1));
    const id = options[Math.floor(random() * options.length)];
    remaining -= relators.get(id).estimate;
    return id;
  });
}

/**
 * Yield at most count identity circuits from deterministic seeded recipes.
 * The caller must prove each circuit's optimum.
 * Keeping search out of this module lets the certifier reject expensive or
 * repetitive candidates without putting exact search in the browser/API.
 */
export function* generateCandidates(seed, { difficulty = 12, count = 48, maxColumns = 32 } = {}) {
  if (!Number.isInteger(difficulty) || difficulty < 3 || difficulty > 20 ||
      !Number.isInteger(count) || count < 1 || count > 1000 ||
      !Number.isInteger(maxColumns) || maxColumns < 4 || maxColumns > 128) {
    throw new RangeError('Choose valid candidate difficulty, count, and width bounds.');
  }
  const ids = [...relators.keys()];
  for (let attempt = 0; attempt < count; attempt++) {
    const random = seededRandom(`${seed}:rule-relators-v1:${attempt}`);
    const pick = values => values[Math.floor(random() * values.length)];
    const availableFamilies = families.filter(family => !family ||
      family.reduce((total, name) => total + relators.get(ids.find(id => id === name || id.startsWith(name + '-'))).estimate, 0) <= difficulty);
    const family = availableFamilies[attempt % availableFamilies.length];
    const selected = difficulty <= 6 ? smallRecipe(ids, difficulty, random)
      : family ? family.map(name => pick(ids.filter(id => id === name || id.startsWith(name + '-'))))
        : Array.from({ length: random() < .5 ? 2 : 3 }, () => pick(ids));
    if (random() < .5) selected.reverse();
    const parts = selected.map(id => {
      let circuit = relators.get(id).circuit;
      if (random() < .5) circuit = reverse(circuit);
      if (random() < .5) circuit = reflect(circuit);
      return pad(circuit, circuit.length === 3 ? 0 : Math.floor(random() * (4 - circuit.length)));
    });
    let circuit = compactCircuit(parts.reduce(join));
    const estimate = selected.reduce((total, id) => total + relators.get(id).estimate, 0);
    const growth = Math.max(0, Math.min(8, difficulty - estimate + (attempt % 7 === 6 ? 1 : 0)));
    const seen = new Set([circuitKey(circuit)]);
    for (let step = 0; step < growth; step++) {
      const bound = lowerBound(circuit);
      const options = getRewriteMoves(circuit, { allowedRules: LEARNED_RULE_IDS })
        .filter(option => lowerBound(option.next) === bound + 1 && option.next[0].length <= maxColumns);
      if (!options.length) break;
      const option = pickWeighted(options, random);
      circuit = compactCircuit(option.next);
      seen.add(circuitKey(circuit));
    }
    // Mix equal-bound rewrites as well as growth. Commutation, transfer, and
    // corner moves must be allowed even though they do not raise the bound.
    const perturbations = attempt % 3;
    for (let step = 0; step < perturbations; step++) {
      const bound = lowerBound(circuit);
      const options = getRewriteMoves(circuit, { allowedRules: LEARNED_RULE_IDS })
        .filter(option => lowerBound(option.next) === bound && option.next[0].length <= maxColumns &&
          !option.move.rule.startsWith('cancel-') && !seen.has(circuitKey(compactCircuit(option.next))));
      if (!options.length) break;
      const option = pickWeighted(options, random);
      circuit = compactCircuit(option.next);
      seen.add(circuitKey(circuit));
    }
    if (circuit[0].length <= maxColumns && lowerBound(circuit) <= difficulty) {
      yield circuit;
    }
  }
}
