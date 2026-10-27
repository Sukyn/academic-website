export const AUDITED_ZOO_COMMIT = '1796234999986410d282ccc13aa6669ef6a18fb5';

const fragmentPaper = '2602.09874v3';
const phasePaper = '2603.06466v3';
const references = new Map();

for (const [id, figure] of Object.entries({
  qubit_clifford: 2, real_clifford: 3, qutrit_clifford: 4,
  clifford_t: 5, clifford_cs: 6, cnot_dihedral: 7,
})) {
  const corrected = id === 'real_clifford';
  references.set(id, {
    arxiv: fragmentPaper, adapted: corrected,
    note: `Figure ${figure}. ${corrected ? 'The zoo corrects the printed right-hand side of CF.'
      : id === 'clifford_cs' ? 'The SH rule is expanded for k = 0, 1, 2, 3.' : 'Published presentation encoded with fixed generators and shortcuts.'}`,
  });
}

for (const [family, figures] of Object.entries({
  affine: '1', linear_phase: '1 and 3', quadratic_phase: '1, 3 and 4', cubic_phase: '1, 3, 4 and 5',
})) {
  const location = `${family === 'affine' ? 'Figure' : 'Figures'} ${figures}`;
  references.set(`${family}_d5`, {
    arxiv: phasePaper, adapted: false,
    note: `${location}; parameter families expanded at d = 5.`,
  });
  for (const dimension of family === 'affine' ? [5, 7, 11] : [5, 7]) {
    references.set(`${family}_simplified_d${dimension}`, {
      arxiv: phasePaper, adapted: true,
      note: `Colin’s simplified d = ${dimension} variant of ${location}, using one multiplier and reduced equations. This exact presentation is not printed in the paper.`,
    });
  }
}

references.set('real_clifford_ch', {
  arxiv: '2602.06644v1', adapted: false,
  note: 'Figure 4, with schema (19) instantiated only for n = 5,…,10; the paper includes every n ≥ 5.',
});
references.set('realclifford-ch-simplified', {
  arxiv: '2602.06644v1', adapted: true,
  note: 'Colin’s simplified variant of Figure 4: equations (4), (9) and (16) are removed, and schema (19) is instantiated only for n = 5,…,10. This exact presentation is not printed in the paper.',
});

for (const dimension of [3, 5, 7]) {
  references.set(`multi_qudit_clifford_d${dimension}`, {
    arxiv: '2609.40106v2', adapted: true,
    note: `Colin’s reduced d = ${dimension} variant of the older LIQCS extended abstract, with adjusted multiplier shortcuts. The related arXiv paper has a different 16-rule presentation and scalar convention.`,
  });
}

const arxivIdentifier = /^(?:[0-9]{2}(?:0[1-9]|1[0-2])\.[0-9]{4,5}|quant-ph\/[0-9]{2}(?:0[1-9]|1[0-2])[0-9]{3})(?:v[1-9][0-9]*)?$/;

export function describeZooEntry(entry, commit) {
  const original = typeof entry.name === 'string' ? entry.name : entry.id;
  let name = original.replace(/\s*\(Figure\s+\d+\)\s*$/i, '').trim() || original;
  if (entry.id === 'real_clifford_ch') name = 'Real Clifford+CH';
  if (entry.id === 'realclifford-ch-simplified') name = 'Real Clifford+CH (simplified)';
  const audited = commit === AUDITED_ZOO_COMMIT;
  const reference = (audited && references.get(entry.id)) || {
    arxiv: typeof entry.arxiv === 'string' && entry.arxiv.trim() === entry.arxiv && arxivIdentifier.test(entry.arxiv) ? entry.arxiv : null,
    adapted: true,
    note: audited ? 'The exact presentation has not been verified against a paper. Ask Colin for its provenance.'
      : 'This GitHub revision has not been checked against the paper. Ask Colin for the exact presentation.',
  };
  return { name, ...reference };
}
