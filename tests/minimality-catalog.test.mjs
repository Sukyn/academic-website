import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { AUDITED_ZOO_COMMIT, describeZooEntry as describeEntry } from '../src/lib/minimality/zoo-catalog.js';
import { importTheory, parseTheoryFile } from '../src/lib/minimality/zoo.js';

const directory = new URL('./fixtures/minimality/zoo/', import.meta.url);
const entries = readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(filename => {
  const theory = JSON.parse(readFileSync(new URL(filename, directory), 'utf8'));
  return { id: filename.slice(0, -5), name: theory.name, theory };
});
const byId = id => entries.find(entry => entry.id === id);
const describeZooEntry = entry => describeEntry(entry, AUDITED_ZOO_COMMIT);

test('the audit boundary matches the frozen fixture revision', () => {
  const readme = readFileSync(new URL('./fixtures/minimality/README.md', import.meta.url), 'utf8');
  assert.match(readme, new RegExp(`commit \x60${AUDITED_ZOO_COMMIT}\x60`));
});

test('every frozen zoo presentation has a distinct name and audited provenance', () => {
  assert.equal(entries.length, 24);
  const names = new Set(), adapted = [];
  for (const entry of entries) {
    const before = JSON.stringify(entry);
    const description = describeZooEntry(entry);
    const key = description.name.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
    assert.equal(names.has(key), false, description.name);
    names.add(key);
    assert.doesNotMatch(description.name, /\(Figure\s+\d+\)/i);
    assert.ok(description.arxiv && description.note, entry.id);
    assert.equal(JSON.stringify(entry), before, entry.id);
    if (description.adapted) adapted.push(entry.id);
  }
  assert.deepEqual(adapted, [
    'affine_simplified_d11', 'affine_simplified_d5', 'affine_simplified_d7',
    'cubic_phase_simplified_d5', 'cubic_phase_simplified_d7',
    'linear_phase_simplified_d5', 'linear_phase_simplified_d7',
    'multi_qudit_clifford_d3', 'multi_qudit_clifford_d5', 'multi_qudit_clifford_d7',
    'quadratic_phase_simplified_d5', 'quadratic_phase_simplified_d7',
    'real_clifford', 'realclifford-ch-simplified',
  ]);
  assert.equal(names.size - adapted.length, 10);
});

test('citations pin the editions used in the audit rather than an unversioned upstream URL', () => {
  for (const entry of entries) {
    const expected = /^(affine|linear_phase|quadratic_phase|cubic_phase)_/.test(entry.id) ? '2603.06466v3'
      : entry.id.startsWith('multi_qudit') ? '2609.40106v2'
        : ['real_clifford_ch', 'realclifford-ch-simplified'].includes(entry.id) ? '2602.06644v1' : '2602.09874v3';
    assert.equal(describeZooEntry({ ...entry, arxiv: '1234.56789' }).arxiv, expected, entry.id);
  }
});

test('CH variants disclose removed equations and the finite schema instead of sharing a title', () => {
  const original = describeZooEntry(byId('real_clifford_ch'));
  const simplified = describeZooEntry(byId('realclifford-ch-simplified'));
  assert.equal(original.name, 'Real Clifford+CH');
  assert.equal(simplified.name, 'Real Clifford+CH (simplified)');
  assert.match(original.note, /n = 5,…,10.*every n ≥ 5/);
  assert.match(simplified.note, /\(4\), \(9\) and \(16\) are removed/);
  assert.match(simplified.note, /n = 5,…,10/);
  const originalRules = byId('real_clifford_ch').theory.equations.map(rule => rule.id);
  const simplifiedRules = new Set(byId('realclifford-ch-simplified').theory.equations.map(rule => rule.id));
  assert.deepEqual(originalRules.filter(id => !simplifiedRules.has(id)), ['4', '9', '16']);
});

test('references distinguish parameter expansion, personal simplification and corrections', () => {
  assert.match(describeZooEntry(byId('affine_d5')).note, /parameter families expanded at d = 5/);
  assert.match(describeZooEntry(byId('affine_simplified_d11')).note, /one multiplier.*not printed/);
  assert.match(describeZooEntry(byId('real_clifford')).note, /corrects.*CF/);
  assert.match(describeZooEntry(byId('clifford_cs')).note, /k = 0, 1, 2, 3/);
  for (const dimension of [3, 5, 7]) {
    const description = describeZooEntry(byId(`multi_qudit_clifford_d${dimension}`));
    assert.match(description.note, /older LIQCS extended abstract/);
    assert.match(description.note, /different 16-rule presentation and scalar convention/);
  }
});

test('catalog descriptions still work after API source metadata is stripped', () => {
  for (const entry of entries) {
    const theory = structuredClone(entry.theory);
    delete theory.source;
    assert.deepEqual(describeZooEntry({ ...entry, theory }), describeZooEntry(entry));
  }
});

test('unrecognised presentations stay unverified even with a plausible paper link or familiar id prefix', () => {
  for (const id of ['new_theory', 'affine_d3', 'multi_qudit_clifford_d11', 'qubit_clifford_new']) {
    const entry = { id, name: 'New theory (Figure 9)', arxiv: '2602.09874v3' };
    const description = describeZooEntry(entry);
    assert.equal(description.name, 'New theory');
    assert.equal(description.arxiv, entry.arxiv);
    assert.equal(description.adapted, true);
    assert.match(description.note, /not been verified/);
    assert.deepEqual(entry, { id, name: 'New theory (Figure 9)', arxiv: '2602.09874v3' });
  }
  assert.equal(describeZooEntry({ id: 'new_theory' }).name, 'new_theory');
  assert.equal(describeZooEntry({ id: 'new_theory', name: '(Figure 9)' }).name, '(Figure 9)');
});

test('unknown reference fallback accepts only arXiv identifiers, including legacy quant-ph ids', () => {
  for (const arxiv of [null, undefined, {}, 'javascript:alert(1)', 'https://arxiv.org/abs/2602.09874',
    '2613.12345', '2600.12345', '2602.123', '2602.123456', '2602.09874v0', 'quant-ph/9913999', '2602.09874\n']) {
    assert.equal(describeZooEntry({ id: 'unknown', name: 'Unknown', arxiv }).arxiv, null, String(arxiv));
  }
  for (const arxiv of ['2602.09874', '2602.09874v3', '0704.0001', 'quant-ph/9501001', 'quant-ph/9501001v2']) {
    assert.equal(describeZooEntry({ id: 'unknown', name: 'Unknown', arxiv }).arxiv, arxiv);
  }
});

test('catalog-only names do not rewrite titles in imported native or source theory files', () => {
  const source = { name: 'My theory (Figure 9)', generators: { H: 1 },
    equations: [{ id: 'H2', lhs: { gen: 'H', repeat: 2 }, rhs: { id: 1 } }] };
  assert.equal(importTheory(source).name, source.name);
  assert.equal(parseTheoryFile(JSON.stringify(source)).name, source.name);
  assert.equal(describeZooEntry({ id: 'custom', name: source.name }).name, 'My theory');
});

test('different or missing GitHub revisions cannot inherit audited presentation claims', () => {
  for (const entry of entries) {
    const source = { ...entry, arxiv: '2602.09874' };
    const audited = describeEntry(source, AUDITED_ZOO_COMMIT);
    for (const commit of [undefined, null, '', 'a'.repeat(40), AUDITED_ZOO_COMMIT.toUpperCase()]) {
      const description = describeEntry(source, commit);
      assert.equal(description.name, audited.name);
      assert.equal(description.adapted, true);
      assert.equal(description.arxiv, source.arxiv);
      assert.equal(description.note, 'This GitHub revision has not been checked against the paper. Ask Colin for the exact presentation.');
      assert.doesNotMatch(description.note, /Figure|removed|corrects/);
    }
    assert.equal(describeEntry({ ...entry, arxiv: 'https://example.com' }).arxiv, null);
    assert.equal(describeEntry(entry, 'a'.repeat(40)).arxiv, null);
  }
});
