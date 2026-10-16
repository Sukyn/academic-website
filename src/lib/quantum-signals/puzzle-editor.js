import { controlWire, validatePlayablePuzzle } from './engine.js';
import { draftFromPuzzle, resizeDraft, setDraftEntry, connectDraftEntry, puzzleFromDraft } from './editor.js';
import { gateIcon, gateLabel } from './rendering.js';
import { PHASE_COLORS, phaseColor } from './state-visuals.js';

const SINGLE = ['I', 'H', 'X', 'Z'], PAIR = ['I', 'CX', 'XC', 'CZ'], STEP = 64;
const TOOLS = [['H', 'H'], ['X', 'X'], ['Z', 'Z'], ['hole', 'Hole'],
  ['control', 'CNOT control'], ['target', 'CNOT target'], ['phase', 'CZ control'],
  ['hole-pair', 'Two-wire hole'], ['empty', 'Erase']];
const element = (tag, className) => { const node = document.createElement(tag); if (className) node.className = className; return node; };
const endpointLabel = role => role === 'phase' ? 'CZ control' : role === 'hole' ? 'hole' : 'CNOT ' + role;
const holeIcon = () => element('span', 'editor-hole');
function endpointIcon(role) {
  const icon = element('span', 'editor-endpoint-icon');
  icon.append(role === 'hole' ? holeIcon() : gateIcon(role === 'target' ? 'X' : 'Z'));
  return icon;
}
function toolIcon(tool) {
  if (tool === 'empty') { const icon = element('span', 'editor-erase'); icon.textContent = '×'; return icon; }
  if (tool === 'hole') return holeIcon();
  if (tool === 'control' || tool === 'target') return endpointIcon(tool);
  if (tool === 'phase') return gateIcon('CZ');
  if (tool === 'hole-pair') { const icon = element('span', 'editor-pair-hole'); icon.append(holeIcon(), holeIcon()); return icon; }
  return gateIcon(tool);
}

export function createPuzzleEditor({ get, onPlay }) {
  let draft, column = 0, wire = 0, linking = null;
  const form = get('puzzle-editor-form'), board = get('editor-board'), menu = get('editor-menu');
  const workspace = get('editor-workspace');
  const at = (col, row) => draft.columns[col]?.find(entry => entry.wires.includes(row));
  const cell = () => get('editor-cell-' + column + '-' + wire);
  const focusCell = () => cell()?.focus({ preventScroll: true });
  function closeMenu() { menu.hidden = true; cell()?.setAttribute('aria-expanded', 'false'); }
  function positionMenu() {
    if (menu.hidden || !cell()) return;
    const anchor = cell().getBoundingClientRect(), parent = workspace.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    menu.style.left = Math.max(0, Math.min(anchor.left - parent.left + (anchor.width - size.width) / 2, parent.width - size.width)) + 'px';
    const below = anchor.bottom + 6;
    const preferred = below + size.height <= innerHeight - 8 ? below : anchor.top - size.height - 6;
    const top = Math.max(8, Math.min(preferred, innerHeight - size.height - 8));
    menu.style.top = top - parent.top + 'px';
  }
  function renderBoard() {
    board.style.gridTemplateColumns = 'repeat(' + draft.columns.length + ', ' + STEP + 'px)';
    const fragment = document.createDocumentFragment(), selected = at(column, wire);
    for (let row = 0; row < draft.wires; row++) for (let col = 0; col < draft.columns.length; col++) {
      const entry = at(col, row), active = col === column && (row === wire || Boolean(selected?.wires.includes(row)));
      const button = element('button', 'editor-cell'); button.type = 'button';
      button.id = 'editor-cell-' + col + '-' + row; button.dataset.editorCell = col + ':' + row;
      button.tabIndex = col === column && row === wire ? 0 : -1;
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-controls', 'editor-menu');
      button.setAttribute('aria-expanded', String(!menu.hidden && col === column && row === wire));
      const connectable = linking && col === linking.column && row !== linking.wire;
      if (connectable) button.dataset.connectable = 'true';
      let label = 'Empty wire';
      if (entry?.endpoint) {
        button.dataset.endpoint = entry.endpoint;
        button.append(endpointIcon(entry.endpoint)); label = 'Unconnected ' + endpointLabel(entry.endpoint);
      } else if (entry?.id) { button.append(holeIcon()); label = 'Hole'; }
      else if (entry?.gate && entry.gate !== 'I') {
        const gate = entry.gate, glyph = gate === 'CX' || gate === 'XC' ? row === controlWire(gate, entry.wires) ? 'Z' : 'X' : gate === 'CZ' ? 'Z' : gate;
        button.append(gateIcon(glyph)); label = gateLabel(gate, entry.wires);
      }
      button.setAttribute('aria-label', 'Column ' + (col + 1) + ', wire ' + (row + 1) + ': ' + label + (connectable ? '. Connect here' : ''));
      fragment.append(button);
    }
    draft.columns.forEach((entries, col) => entries.forEach(entry => {
      if (entry.wires.length !== 2 || entry.gate === 'I') return;
      const link = element('span', 'editor-link'); link.setAttribute('aria-hidden', 'true');
      link.style.left = (col + .5) * STEP + 'px'; link.style.top = (Math.min(...entry.wires) + .5) * STEP + 'px';
      link.style.height = (Math.max(...entry.wires) - Math.min(...entry.wires)) * STEP + 'px'; fragment.append(link);
    }));
    board.replaceChildren(fragment);
  }
  function renderMenu() {
    get('editor-tools').replaceChildren(...TOOLS.filter(([tool]) => draft.wires > 1 || !['control', 'target', 'phase', 'hole-pair'].includes(tool)).map(([tool, label]) => {
      const button = element('button', 'editor-tool'); button.type = 'button'; button.dataset.editorTool = tool;
      button.id = 'editor-tool-' + tool; button.title = label; button.setAttribute('aria-label', label); button.append(toolIcon(tool)); return button;
    }));
    const entry = at(column, wire);
    get('editor-choices').hidden = !entry?.id;
    get('editor-gates').replaceChildren(...(entry?.id ? (entry.wires.length === 2 ? PAIR : SINGLE).map(gate => {
      const button = element('button', 'editor-tool'); button.type = 'button'; button.dataset.editorChoice = gate;
      button.id = 'editor-choice-' + gate; button.title = gateLabel(gate, entry.wires);
      button.setAttribute('aria-label', 'Offer ' + gateLabel(gate, entry.wires));
      button.setAttribute('aria-pressed', String(entry.choices.includes(gate))); button.append(gateIcon(gate, entry.wires)); return button;
    }) : []));
  }
  function renderTargets() {
    get('editor-targets').replaceChildren(...draft.weights.map((weight, basis) => {
      const bits = basis.toString(2).padStart(draft.wires, '0'), button = element('button', 'editor-target');
      button.type = 'button'; button.id = 'editor-target-' + basis;
      button.dataset.editorTarget = basis; button.dataset.sign = weight;
      const phase = weight === 0 ? 'off' : weight > 0 ? 'positive phase' : 'negative phase';
      button.setAttribute('aria-label', 'Target ' + bits + ': ' + phase); button.title = phase;
      const text = element('span'); text.textContent = bits;
      const line = element('span', 'editor-target-line'), dot = element('span', 'editor-target-dot');
      line.setAttribute('aria-hidden', 'true'); dot.setAttribute('aria-hidden', 'true');
      if (weight) { dot.style.background = phaseColor(weight); dot.style.borderColor = PHASE_COLORS.negative; }
      button.append(text, line, dot); return button;
    }));
  }
  function render() {
    const focused = form.contains(document.activeElement) ? document.activeElement.id : null;
    get('editor-wires').value = String(draft.wires); get('editor-columns').value = String(draft.columns.length);
    if (linking && !at(linking.column, linking.wire)?.endpoint) linking = null;
    renderBoard();
    if (!menu.hidden) { renderMenu(); positionMenu(); }
    if (focused) get(focused)?.focus({ preventScroll: true });
  }
  function report(action) {
    try { action(); get('custom-status').textContent = ''; }
    catch (error) { get('custom-status').textContent = error.message; render(); }
  }
  function load(puzzle) {
    draft = puzzle ? draftFromPuzzle(puzzle) : { wires: 2, columns: Array.from({ length: 4 }, () => []), weights: [1, 0, 0, 0] };
    column = wire = 0; linking = null; closeMenu();
    get('editor-scroll').scrollLeft = get('editor-targets').scrollTop = 0;
    get('custom-status').textContent = ''; renderTargets(); render();
  }
  function chooseTool(tool) {
    const current = at(column, wire);
    let entry;
    if (['control', 'target', 'phase', 'hole-pair'].includes(tool)) {
      entry = { endpoint: tool === 'hole-pair' ? 'hole' : tool, wires: [wire] };
    } else entry = tool === 'empty' ? null : tool === 'hole' ?
      { wires: [wire], choices: current?.id && current.wires.length === 1 ? current.choices : SINGLE } : { gate: tool, wires: [wire] };
    draft = setDraftEntry(draft, column, entry, wire);
    linking = entry?.endpoint ? { column, wire } : null;
    if (tool !== 'hole') closeMenu();
    render();
    if (tool === 'hole') get('editor-gates').querySelector('button')?.focus({ preventScroll: true });
    else focusCell();
  }
  board.addEventListener('click', event => {
    const button = event.target.closest('[data-editor-cell]'); if (!button) return;
    const [col, row] = button.dataset.editorCell.split(':').map(Number);
    report(() => {
      if (linking && col === linking.column && row !== linking.wire) {
        draft = connectDraftEntry(draft, col, linking.wire, row); linking = null;
        column = col; wire = row; closeMenu(); render(); focusCell(); return;
      }
      const resume = at(col, row)?.endpoint && (col !== column || row !== wire || !linking);
      column = col; wire = row; linking = at(col, row)?.endpoint ? { column, wire } : null;
      menu.hidden = Boolean(resume); render();
      if (menu.hidden) focusCell(); else menu.querySelector('button')?.focus({ preventScroll: true });
    });
  });
  board.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace'].includes(event.key)) return;
    const button = event.target.closest('[data-editor-cell]'); if (!button) return;
    [column, wire] = button.dataset.editorCell.split(':').map(Number);
    event.preventDefault();
    report(() => {
      closeMenu();
      if (event.key === 'Delete' || event.key === 'Backspace') draft = setDraftEntry(draft, column, null, wire);
      else {
        column = Math.max(0, Math.min(draft.columns.length - 1, column + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)));
        wire = Math.max(0, Math.min(draft.wires - 1, wire + (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)));
      }
      render(); focusCell(); cell()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });
  get('editor-tools').addEventListener('click', event => {
    const button = event.target.closest('[data-editor-tool]'); if (button) report(() => chooseTool(button.dataset.editorTool));
  });
  get('editor-gates').addEventListener('click', event => {
    const button = event.target.closest('[data-editor-choice]'); if (!button) return;
    report(() => {
      const current = at(column, wire), offered = current.wires.length === 2 ? PAIR : SINGLE, chosen = new Set(current.choices);
      if (chosen.has(button.dataset.editorChoice)) chosen.delete(button.dataset.editorChoice); else chosen.add(button.dataset.editorChoice);
      draft = setDraftEntry(draft, column, { ...current, choices: offered.filter(gate => chosen.has(gate)) }, wire); render();
    });
  });
  for (const id of ['editor-wires', 'editor-columns']) get(id).addEventListener('change', () => report(() => {
    draft = resizeDraft(draft, { wires: Number(get('editor-wires').value), columns: Number(get('editor-columns').value) });
    column = Math.min(column, draft.columns.length - 1); wire = Math.min(wire, draft.wires - 1); linking = null; closeMenu(); renderTargets(); render();
  }));
  get('editor-targets').addEventListener('click', event => {
    const button = event.target.closest('[data-editor-target]'); if (!button) return;
    const index = Number(button.dataset.editorTarget), weights = [...draft.weights];
    weights[index] = weights[index] === 0 ? 1 : weights[index] === 1 ? -1 : 0;
    draft = { ...draft, weights }; get('custom-status').textContent = ''; renderTargets();
    get('editor-target-' + index).focus({ preventScroll: true });
  });
  form.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || (menu.hidden && !linking)) return;
    event.preventDefault();
    if (menu.hidden) linking = null;
    closeMenu(); renderBoard(); focusCell();
  });
  document.addEventListener('pointerdown', event => { if (!menu.hidden && !menu.contains(event.target) && !board.contains(event.target)) closeMenu(); });
  get('editor-scroll').addEventListener('scroll', positionMenu); window.addEventListener('resize', positionMenu);
  window.addEventListener('scroll', positionMenu, { passive: true });
  form.addEventListener('submit', event => {
    event.preventDefault(); closeMenu();
    report(() => {
      const pendingColumn = draft.columns.findIndex(entries => entries.some(entry => entry.endpoint));
      const unconnected = draft.columns[pendingColumn]?.find(entry => entry.endpoint);
      if (unconnected) {
        column = pendingColumn; wire = unconnected.wires[0]; linking = { column, wire }; render(); focusCell();
        cell()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (!draft.weights.some(Boolean)) {
        get('editor-target-0').focus(); get('editor-target-0').scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      onPlay(validatePlayablePuzzle(puzzleFromDraft(draft)));
    });
  });
  return { load };
}
