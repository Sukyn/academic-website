import {
  LIMITS, createTheory, addGenerator, updateGenerator, removeGenerator,
  addRule, updateRule, removeRule, placeGate, insertGate, getCircuitColumns, removeGates, exportTheory,
  addShortcut, updateShortcut, removeShortcut,
  availableGates, supportsControls, touchedWires, controlCircuit, removeControls, serializeDraft, parseDraft,
} from '../lib/minimality/model.js';
import { consumeSearchStream, summarizeWitness, formatWitnessValue } from '../lib/minimality/stream.js';
import { importTheory, parseTheoryFile } from '../lib/minimality/zoo.js';
import { describeZooEntry } from '../lib/minimality/zoo-catalog.js';
import { moveCircuitFocus } from '../lib/minimality/circuit-navigation.js';
import { displayName } from '../lib/minimality/format.js';
import { downloadBlob } from '../lib/browser/files.js';
import { ignoresShortcut } from '../lib/browser/shortcuts.js';
import { svgNode } from '../lib/games/circuit-graphics.js';

const app = document.getElementById('minimality-app');
if (app) initialize(app);

function initialize(root) {
  const get = id => root.querySelector(`#${id}`);
  const picker = get('generator-picker');
  const references = document.getElementById('theory-references-list');
  const storageKey = 'minimality-theory-v1';
  let draft = createTheory();
  let selectedGenerator = null;
  let selection = [];
  let dragPayload = null;
  let dropTarget = null;
  let pickerTarget = null;
  let importTicket = 0;
  let requestController = null;
  let history = [];
  let future = [];
  const resultRows = new Map();
  let zooEntries = null;
  let zooController = null;
  let pressedControl = null;
  let tabbing = false;
  let renderDeferred = false;
  let renderTimer;
  let editorFeedback = null;
  let activeCircuitRow = 0;
  let activeCircuitGrid = null;

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) draft = parseDraft(saved);
  } catch {
    message('The saved theory could not be opened. Use Open to restore a saved file.');
  }
  let draftSource = serializeDraft(draft);
  let gates = indexDraft();

  function indexDraft() {
    const list = availableGates(draft);
    return { list, byId: new Map(list.map(gate => [gate.id, gate])),
      scalarIds: new Set(list.filter(gate => gate.arity === 0).map(gate => gate.id)),
      circuitById: new Map([...draft.rules, ...(draft.shortcuts ?? [])].map(circuit => [circuit.id, circuit])) };
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function button(className, text, label, focusKey) {
    const element = node('button', className, text);
    element.type = 'button';
    if (label) element.setAttribute('aria-label', label);
    if (focusKey) element.dataset.focusKey = focusKey;
    return element;
  }

  function editorField(entry, kind, field) {
    const isName = field === 'name';
    const label = kind === 'rule' ? 'Equation' : kind === 'shortcut' ? 'Shortcut' : 'Generator';
    const input = node(isName ? 'input' : 'select', isName && kind !== 'generator' ? 'equation-name' : '');
    input.dataset.field = `${kind}-${field}`;
    input.dataset.focusKey = `${entry.id}-${field}`;
    input.setAttribute('aria-label', isName
      ? `${label} ${entry.name} name`
      : `Wires for ${kind === 'generator' ? '' : `${label.toLowerCase()} `}${entry.name}`);
    if (isName) {
      Object.assign(input, { maxLength: LIMITS[`${kind}Name`], autocomplete: 'off' });
      if (kind !== 'generator') input.size = Math.max(1, entry.name.length);
    } else {
      for (let count = 0; count <= LIMITS.wires; count++) input.append(new Option(String(count), String(count)));
    }
    input.value = String(entry[field]);
    const prettyName = isName ? displayName(entry.name) : entry.name;
    if (isName && prettyName !== entry.name) {
      const wrapper = node('span', 'name-field');
      const preview = node('span', `${input.className} name-preview`, prettyName);
      preview.setAttribute('aria-hidden', 'true');
      wrapper.append(input, preview);
      return wrapper;
    }
    return input;
  }

  function message(text, target) {
    editorFeedback = text ? { text, focusKey: target?.dataset.focusKey, controlId: target?.id,
      ruleId: target?.closest('[data-rule-id]')?.dataset.ruleId,
      generatorId: target?.closest('[data-generator-id]')?.dataset.generatorId } : null;
    renderFeedback();
  }

  function renderFeedback() {
    root.querySelector('.inline-message')?.remove();
    for (const field of root.querySelectorAll('[data-feedback-field]')) {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
      delete field.dataset.feedbackField;
    }
    const global = get('editor-message');
    global.hidden = true;
    if (!editorFeedback) { global.textContent = ''; return; }
    const { text, focusKey, controlId, ruleId, generatorId } = editorFeedback;
    const field = focusKey ? root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`) : controlId ? get(controlId) : null;
    const context = field?.closest('.equation-card, .generator-row, .structure-panel, .theory-title, .search-controls, .workspace-actions')
      ?? (ruleId ? root.querySelector(`[data-rule-id="${CSS.escape(ruleId)}"]`) : null)
      ?? (generatorId ? root.querySelector(`[data-generator-id="${CSS.escape(generatorId)}"]`) : null);
    const output = context ? node('p', 'editor-message inline-message', text) : global;
    output.textContent = text;
    output.hidden = false;
    if (context) {
      output.id = 'minimality-local-message';
      output.setAttribute('role', 'status');
      output.setAttribute('aria-live', 'polite');
      const toolbar = context.querySelector('.equation-toolbar');
      if (toolbar) toolbar.after(output);
      else if (context.matches('.theory-title')) context.after(output);
      else context.append(output);
      const disclosure = context.closest('details');
      if (disclosure) disclosure.open = true;
      if (field?.matches('input, select')) {
        field.setAttribute('aria-invalid', 'true');
        field.setAttribute('aria-describedby', output.id);
        field.dataset.feedbackField = '';
      }
    }
  }

  function persist() {
    try { localStorage.setItem(storageKey, draftSource); }
    catch { message('Browser storage is unavailable. Save a file to keep this theory.'); }
  }

  function renderZoo() {
    const select = get('theory-zoo');
    const prompt = zooController ? 'Loading…' : zooEntries ? 'Choose a theory…' : 'Zoo unavailable';
    select.replaceChildren(new Option(prompt, ''));
    const entries = [...(zooEntries?.values() ?? [])].sort((a, b) => Number(!a.draft) - Number(!b.draft) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    references.replaceChildren();
    const unavailable = get('zoo-unavailable-list');
    unavailable.replaceChildren();
    for (const entry of entries) {
      const option = new Option(entry.name, entry.id);
      option.disabled = !entry.draft;
      if (entry.reason) option.title = entry.reason;
      select.append(option);
      if (entry.reason) unavailable.append(node('dt', '', entry.name), node('dd', '', entry.reason));
      const name = node('dt', '', entry.name);
      name.dataset.theoryId = entry.id;
      const reference = node('dd');
      const links = node('div', 'reference-links');
      if (entry.adapted || !entry.arxiv) {
        const contact = node('a', '', 'Ask Colin');
        contact.href = `mailto:${references.dataset.contact}?subject=${encodeURIComponent(`Reference for ${entry.name}`)}`;
        links.append(contact);
      }
      if (entry.arxiv) {
        const citation = node('a', '', entry.adapted ? `Related paper · arXiv:${entry.arxiv}` : `arXiv:${entry.arxiv}`);
        citation.href = `https://arxiv.org/abs/${encodeURI(entry.arxiv)}`;
        citation.target = '_blank';
        citation.rel = 'noopener noreferrer';
        links.append(citation);
      }
      reference.append(links, node('p', 'reference-note', entry.note));
      references.append(name, reference);
    }
    select.setAttribute('aria-busy', String(Boolean(zooController)));
    const unavailableCount = entries.filter(entry => entry.reason).length;
    get('zoo-unavailable').hidden = !unavailableCount;
    get('zoo-unavailable').querySelector('summary').textContent = `Unavailable theories (${unavailableCount})`;
    lockEditor();
  }

  async function loadZoo() {
    if (zooController) return;
    const controller = new AbortController();
    zooController = controller;
    renderZoo();
    const deadline = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch('/api/minimality?zoo=1', { signal: controller.signal });
      const catalog = await response.json();
      if (!response.ok) throw new Error(catalog.message || 'The official theory zoo could not be loaded.');
      if (!Array.isArray(catalog.theories) || catalog.theories.length > 128) throw new Error('The theory zoo returned an unsupported catalog.');
      const entries = new Map();
      for (const entry of catalog.theories) {
        if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || entries.has(entry.id)) throw new Error('The theory zoo returned an unsupported catalog.');
        const description = describeZooEntry(entry, catalog.commit);
        let draft, reason;
        try { draft = importTheory(entry.theory); draft.name = description.name; }
        catch (error) { reason = error.message; }
        entries.set(entry.id, { id: entry.id, ...description, draft, reason });
      }
      if (controller.signal.aborted) return;
      zooEntries = entries;
      get('zoo-message').hidden = true;
      get('reload-zoo').title = 'Reload theory zoo';
    } catch (error) {
      get('reload-zoo').title = error.name === 'AbortError' ? 'The theory zoo request timed out. Reload to try again.' : error.message;
      get('zoo-message').textContent = get('reload-zoo').title;
      get('zoo-message').hidden = false;
    } finally {
      clearTimeout(deadline);
      zooController = null;
      renderZoo();
    }
  }

  function commit(next) {
    if (requestController) return;
    const source = serializeDraft(next);
    if (source === draftSource) return;
    history.push(draftSource);
    history = history.slice(-40);
    future = [];
    restore(source);
  }

  function restore(source) {
    draft = parseDraft(source);
    gates = indexDraft();
    draftSource = source;
    importTicket++;
    selection = [];
    message('');
    get('search-output').hidden = true;
    get('search-summary').textContent = '';
    persist();
    render();
  }

  function edit(action, target = document.activeElement) {
    importTicket++;
    message('');
    try { commit(action()); }
    catch (error) {
      message(error.message, target);
      pressedControl = null;
      tabbing = false;
      render();
      const feedback = editorFeedback;
      requestAnimationFrame(() => {
        if (editorFeedback !== feedback) return;
        const field = feedback.focusKey ? root.querySelector(`[data-focus-key="${CSS.escape(feedback.focusKey)}"]`)
          : feedback.controlId ? get(feedback.controlId) : null;
        field?.focus({ preventScroll: true });
      });
    }
  }

  function nextName(prefix, entries) {
    let index = 1;
    while (entries.some(entry => entry.name === `${prefix}${index}`)) index++;
    return `${prefix}${index}`;
  }

  function render() {
    if (pressedControl?.isConnected || tabbing) { renderDeferred = true; return; }
    renderDeferred = false;
    clearTimeout(renderTimer);
    closePicker(picker.contains(document.activeElement));
    const active = document.activeElement;
    const textSelection = active instanceof HTMLInputElement && active.selectionStart !== null
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection] : null;
    const focusKey = active?.dataset.focusKey;
    const previousSide = active?.closest('[data-side]');
    const previousPosition = active?.closest('[data-wire]')?.dataset;
    const selected = gates.byId.get(selectedGenerator);
    if (!selected || selected.kind) {
      selectedGenerator = draft.generators[0]?.id ?? draft.shortcuts?.[0]?.id ?? null;
    }
    get('theory-name').value = draft.name;
    get('theory-structure').value = draft.structure;
    get('control-values').value = String(draft.controlValues);
    get('control-values-field').hidden = draft.structure !== 'Polycontrolled PROP';
    get('generator-count').textContent = String(draft.generators.length);
    get('shortcut-count').textContent = String(draft.shortcuts?.length ?? 0);
    get('rule-count').textContent = String(draft.rules.length);
    renderGenerators();
    renderCircuits();
    updateSelection();
    lockEditor();
    renderFeedback();
    if (focusKey && !root.contains(active)) {
      let replacement = root.querySelector(`[data-focus-key="${focusKey}"]`);
      if (replacement?.closest('[hidden]')) replacement = null;
      if (!replacement && previousSide) {
        const rule = root.querySelector(`[data-rule-id="${previousSide.closest('[data-rule-id]').dataset.ruleId}"]`);
        const slots = [...(rule?.querySelectorAll(`[data-side="${previousSide.dataset.side}"] .insert-slot`) ?? [])];
        const wire = previousPosition?.wire ?? '0', boundary = Number(previousPosition?.boundary ?? 0);
        replacement = slots.filter(slot => slot.dataset.wire === wire)
          .sort((a, b) => Math.abs(Number(a.dataset.boundary) - boundary) - Math.abs(Number(b.dataset.boundary) - boundary))[0];
      }
      replacement ??= get('add-rule');
      replacement.focus({ preventScroll: true });
      makeCircuitTabStop(replacement);
      if (textSelection && replacement instanceof HTMLInputElement) replacement.setSelectionRange(...textSelection);
    }
  }

  function updateSelection() {
    const selectedIds = new Set(selection.map(operation => operation.id));
    for (const row of root.querySelectorAll('.generator-row, .shortcut-card')) {
      const selected = row.dataset.generatorId === selectedGenerator && !selection.length;
      row.toggleAttribute('data-selected', selected);
      row.querySelector('.generator-drag').setAttribute('aria-pressed', String(selected));
    }
    for (const gate of root.querySelectorAll('.placed-gate')) {
      const selected = selectedIds.has(gate.dataset.operationId);
      gate.toggleAttribute('data-selected', selected);
      gate.querySelector('.gate-chip').setAttribute('aria-pressed', String(selected));
    }
    for (const actions of root.querySelectorAll('.circuit-actions')) {
      const from = location(actions);
      const count = selection.filter(operation => operation.ruleId === from.ruleId && operation.side === from.side).length;
      const remove = actions.querySelector('[data-action="delete-selection"]');
      remove.hidden = !count;
      remove.textContent = count > 1 ? `Delete ${count}` : 'Delete';
      const control = actions.querySelector('[data-action="control-circuit"]');
      if (control) {
        control.textContent = count ? `Control selected (${count})…` : 'Control circuit…';
        control.setAttribute('aria-label', `${count ? `Control ${count} selected gates in` : 'Control circuit on'} ${getCircuit(from.ruleId).name}, ${from.side} side`);
      }
      actions.hidden = !actions.querySelector('button:not([hidden])');
    }
  }

  function lockEditor() {
    const running = Boolean(requestController);
    for (const control of root.querySelectorAll('.minimality-layout button, .minimality-layout input, .minimality-layout select, .document-actions button, #theory-name, #search-timeout')) control.disabled = running;
    get('undo-theory').disabled = running || !history.length;
    get('redo-theory').disabled = running || !future.length;
    get('theory-zoo').disabled = running || Boolean(zooController) || !zooEntries;
    get('reload-zoo').disabled = running || Boolean(zooController);
    get('save-theory').disabled = false;
    get('see-references').disabled = !zooEntries?.size;
    get('add-generator').disabled = running || draft.generators.length >= LIMITS.generators;
    get('add-shortcut').disabled = running || (draft.shortcuts?.length ?? 0) >= LIMITS.shortcuts;
    get('add-rule').disabled = running || draft.rules.length >= LIMITS.rules;
    const searchable = draft.structure === 'PRO' || draft.structure === 'PROP';
    get('run-search').disabled = !running && (!searchable || (draft.structure === 'PRO' && !draft.generators.length) || !draft.rules.length);
    const reason = !searchable ? 'Search currently supports PRO and PROP.'
      : draft.structure === 'PRO' && !draft.generators.length ? 'Add a generator to run a search.'
        : !draft.rules.length ? 'Add an equation to run a search.' : '';
    get('run-search').title = reason;
    get('search-availability').textContent = reason;
    get('search-availability').hidden = running || !reason;
    for (const control of root.querySelectorAll('[data-action="control-circuit"]')) {
      const from = location(control);
      control.disabled = running || !getCircuit(from.ruleId)[from.side].length;
    }
    get('run-search').textContent = running ? 'Stop search' : 'Run search →';
    get('run-search').toggleAttribute('data-running', running);
  }

  function generatorHandle(generator) {
    const drag = button('generator-drag', '⠿', `Select or drag ${generator.name}`, `${generator.id}-select`);
    drag.draggable = true;
    drag.dataset.action = 'select-generator';
    return drag;
  }

  function renderGenerators() {
    const list = get('generator-list');
    list.replaceChildren();
    for (const generator of draft.generators) {
      const row = node('div', 'generator-row');
      row.dataset.generatorId = generator.id;
      const remove = button('icon-button', '×', `Remove generator ${generator.name}`, `${generator.id}-remove`);
      remove.dataset.action = 'remove-generator';
      row.append(generatorHandle(generator), editorField(generator, 'generator', 'name'), editorField(generator, 'generator', 'arity'), remove);
      list.append(row);
    }
  }

  function renderCircuits() {
    const scrollPositions = new Map([...root.querySelectorAll('.circuit-side')].map(side =>
      [`${side.closest('[data-rule-id]').dataset.ruleId}:${side.dataset.side}`, side.scrollLeft]));
    get('rule-list').replaceChildren();
    get('shortcut-list').replaceChildren();
    const circuits = [
      ...(draft.shortcuts ?? []).map(rule => ({ rule, kind: 'shortcut' })),
      ...draft.rules.map(rule => ({ rule, kind: 'rule' })),
    ];
    for (const { rule, kind } of circuits) {
      const shortcut = kind === 'shortcut';
      const card = node('article', shortcut ? 'equation-card shortcut-card' : 'equation-card');
      card.dataset.ruleId = rule.id;
      if (shortcut) {
        card.dataset.shortcutId = rule.id;
        card.dataset.generatorId = rule.id;
      }
      card.setAttribute('aria-label', `${shortcut ? 'Shortcut' : 'Equation'} ${rule.name}`);
      const toolbar = node('div', 'equation-toolbar');
      const wires = node('label', 'rule-wires');
      if (!shortcut) wires.append(node('span', '', 'Wires'));
      wires.append(editorField(rule, kind, 'wires'));
      const remove = button('icon-button', '×', `Remove ${shortcut ? 'shortcut' : 'equation'} ${rule.name}`, `${rule.id}-remove`);
      remove.dataset.action = `remove-${kind}`;
      if (shortcut) toolbar.append(generatorHandle(rule));
      toolbar.append(editorField(rule, kind, 'name'), wires, remove);
      const diagrams = node('div', shortcut ? 'shortcut-diagrams' : 'equation-diagrams');
      const layout = {
        columns: { left: getCircuitColumns(rule.left), right: getCircuitColumns(rule.right) },
        wireOffset: rule.wires > 0 && [...rule.left, ...rule.right].some(operation => gates.scalarIds.has(operation.generator)) ? 1 : 0,
      };
      diagrams.style.setProperty('--circuit-rows', Math.max(1, rule.wires) + layout.wireOffset);
      const width = side => {
        const count = layout.columns[side].length;
        return count ? count * 80 + 32 : 48;
      };
      diagrams.toggleAttribute('data-wide', !shortcut && width('left') + width('right') + 24 > 288);
      diagrams.append(renderSide(rule, 'left', layout));
      if (!shortcut) diagrams.append(node('span', 'equation-equals', '='), renderSide(rule, 'right', layout));
      card.append(toolbar, diagrams);
      get(`${kind}-list`).append(card);
    }
    for (const side of root.querySelectorAll('.circuit-side')) {
      side.scrollLeft = scrollPositions.get(`${side.closest('[data-rule-id]').dataset.ruleId}:${side.dataset.side}`) ?? 0;
    }
  }

  function renderSide(rule, side, { columns: columnsBySide, wireOffset }) {
    const polycontrolled = draft.structure === 'Polycontrolled PROP';
    const numberedControls = polycontrolled && draft.controlValues > 2;
    const viewport = node('div', 'circuit-side');
    viewport.dataset.side = side;
    viewport.setAttribute('role', 'group');
    viewport.setAttribute('aria-label', `${rule.name}, ${side} side`);
    const grid = node('div', 'circuit-grid');
    const columns = columnsBySide[side];
    const columnIndex = new Map(columns.map((column, index) => [column, index]));
    const rows = Math.max(1, rule.wires);
    const occupied = new Set();
    const scalarColumns = new Set();
    for (const operation of rule[side]) {
      if (gates.scalarIds.has(operation.generator)) scalarColumns.add(operation.column);
      for (const wire of touchedWires(operation, gates.byId)) occupied.add(`${operation.column}:${wire}`);
    }
    grid.style.setProperty('--columns', columns.length);
    grid.toggleAttribute('data-empty', !columns.length);
    grid.toggleAttribute('data-scalar', rule.wires === 0);
    grid.toggleAttribute('data-phases', Boolean(wireOffset));
    for (let wire = 0; wire < rule.wires; wire++) {
      const line = svgNode('svg', { class: 'wire-line', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': true });
      line.style.setProperty('--wire', wire + wireOffset);
      line.append(wirePath('M0 .5H1'));
      grid.append(line);
    }
    function addSlot(kind, wire, index, phase = false) {
      const insert = kind === 'insert-slot', position = insert ? index : columns[index];
      const label = insert
        ? `Insert on ${rule.name}, ${side} side, ${phase || !rule.wires ? 'global phase' : `wire ${wire + 1}`}, position ${index + 1}`
        : `${rule.name}, ${side} side, ${phase ? 'global phase' : `wire ${wire + 1}`}, column ${index + 1}`;
      const slot = button(`circuit-slot ${kind}`, '+', label, `${rule.id}-${side}-${phase ? 'phase-' : ''}${insert ? 'insert-' : ''}${wire}-${position}`);
      Object.assign(slot.dataset, { action: insert ? 'insert-gate' : 'place-gate', wire, [insert ? 'boundary' : 'column']: position });
      if (phase) slot.dataset.phase = 'true';
      slot.setAttribute('aria-haspopup', 'dialog');
      slot.setAttribute('aria-controls', picker.id);
      slot.setAttribute('aria-expanded', 'false');
      slot.style.gridArea = `${phase ? 1 : wire + wireOffset + 1} / ${index * 2 + (insert ? 1 : 2)}`;
      Object.assign(slot.dataset, { navColumn: index * 2 + (insert ? 0 : 1), navRow: phase ? 0 : wire + wireOffset });
      grid.append(slot);
    }
    for (let boundary = 0; boundary <= columns.length; boundary++) {
      if (wireOffset) {
        addSlot('insert-slot', 0, boundary, true);
        if (boundary < columns.length && !scalarColumns.has(columns[boundary])) addSlot('wire-cell', 0, boundary, true);
      }
      for (let wire = 0; wire < rows; wire++) {
        addSlot('insert-slot', wire, boundary, rule.wires === 0);
        if (boundary < columns.length && rule.wires > 0 && !occupied.has(`${columns[boundary]}:${wire}`)) {
          addSlot('wire-cell', wire, boundary);
        }
      }
    }
    for (const operation of rule[side]) {
      const generator = gates.byId.get(operation.generator);
      const controls = operation.controls ?? [];
      const column = columnIndex.get(operation.column);
      const bodyRow = generator.arity === 0 ? 0 : operation.wire + wireOffset;
      const bodyRows = Math.max(1, generator.arity);
      const controlRows = controls.map(control => control.wire + wireOffset);
      const firstRow = Math.min(bodyRow, ...controlRows);
      const lastRow = Math.max(bodyRow + bodyRows - 1, ...controlRows);
      const wrapper = node('div', 'placed-gate');
      wrapper.dataset.operationId = operation.id;
      wrapper.dataset.wire = operation.wire;
      wrapper.dataset.boundary = column;
      wrapper.style.gridArea = `${firstRow + 1} / ${column * 2 + 2} / span ${lastRow - firstRow + 1} / span 1`;
      wrapper.toggleAttribute('data-scalar', generator.arity === 0);
      const controlDescription = controls.length ? `; controls, outer to inner: ${controls.map(control => `value ${control.value} on wire ${control.wire + 1}`).join('; ')}` : '';
      const label = `${generator.name}, ${rule.name}, ${side} side, position ${column + 1}${controlDescription}`;
      const chip = button(`gate-chip${generator.kind ? ' structural-gate' : ''}`, displayName(generator.name), label, `${operation.id}-select`);
      chip.title = generator.name + controlDescription;
      chip.style.top = `calc(${bodyRow - firstRow} * var(--wire-step))`;
      chip.style.height = `calc(${bodyRows} * var(--wire-step) - .5rem)`;
      if (generator.kind) chip.replaceChildren(crossingGlyph(generator.kind));
      chip.dataset.action = 'select-gate';
      Object.assign(chip.dataset, { navColumn: column * 2 + 1, navRow: bodyRow, navEnd: bodyRow + bodyRows - 1 });
      chip.draggable = true;
      if (controls.length) {
        const svg = svgNode('svg', { class: 'control-wires', viewBox: `0 0 40 ${(lastRow - firstRow + 1) * 48}`, preserveAspectRatio: 'none', 'aria-hidden': true });
        const target = (bodyRow - firstRow + bodyRows / 2) * 48;
        controls.forEach((control, index) => {
          const x = polycontrolled && controls.length > 1 ? 5 + index * 30 / (controls.length - 1) : 20;
          const y = (control.wire + wireOffset - firstRow + .5) * 48;
          svg.append(svgNode('path', { d: `M${x} ${y}V${target}H20`, fill: 'none', stroke: 'var(--color-accent)', 'stroke-width': 1.6 }));
          svg.append(svgNode('circle', { cx: x, cy: y, r: numberedControls ? 8 : 4.5,
            fill: control.value === 1 ? 'var(--color-accent)' : 'var(--color-surface-2)', stroke: 'var(--color-accent)', 'stroke-width': 1.6 }));
          if (numberedControls) {
            const text = svgNode('text', { x, y: y + 3.5, 'text-anchor': 'middle', fill: control.value === 1 ? 'var(--color-surface)' : 'var(--color-accent)', 'font-size': 10 });
            text.textContent = String(control.value);
            svg.append(text);
          }
        });
        wrapper.append(svg);
      }
      wrapper.append(chip);
      grid.append(wrapper);
    }
    const controls = [...grid.querySelectorAll('button')].sort((a, b) => Number(a.dataset.navColumn) - Number(b.dataset.navColumn) || Number(a.dataset.navRow) - Number(b.dataset.navRow));
    controls.forEach((control, index) => { control.tabIndex = index ? -1 : 0; });
    grid.setAttribute('aria-description', 'Use arrow keys to move between gates and insertion positions. Enter opens a position; Tab leaves this circuit.');
    viewport.append(grid);
    const actions = node('div', 'circuit-actions');
    const remove = button('circuit-control delete-selection', 'Delete', `Delete selected gates from ${rule.name}, ${side} side`, `${rule.id}-${side}-delete`);
    remove.dataset.action = 'delete-selection';
    if (supportsControls(draft.structure)) {
      const control = button('circuit-control', 'Control…', `Control ${rule.name}, ${side} side`, `${rule.id}-${side}-control`);
      control.dataset.action = 'control-circuit';
      actions.append(control);
    }
    actions.append(remove);
    viewport.append(actions);
    return viewport;
  }

  function wirePath(d, mask = false) {
    return svgNode('path', { d, fill: 'none',
      stroke: mask ? 'var(--color-surface-2)' : 'var(--wire-color)', 'stroke-width': mask ? 8 : 1,
      'vector-effect': 'non-scaling-stroke' });
  }

  function crossingGlyph(kind) {
    const svg = svgNode('svg', { viewBox: '0 0 40 88', preserveAspectRatio: 'none', 'aria-hidden': true });
    const paths = ['M0 20C10 20 14 34 20 44S30 68 40 68', 'M0 68C10 68 14 54 20 44S30 20 40 20'];
    const over = kind === 'braid-inverse' ? 1 : 0;
    svg.append(...paths.map(d => wirePath(d)));
    if (kind !== 'swap') svg.append(wirePath(paths[over], true), wirePath(paths[over]));
    return svg;
  }

  function location(element) {
    return { ruleId: element.closest('[data-rule-id]')?.dataset.ruleId,
      side: element.closest('[data-side]')?.dataset.side,
      id: element.closest('[data-operation-id]')?.dataset.operationId };
  }

  function getCircuit(id) {
    return gates.circuitById.get(id);
  }

  function makeCircuitTabStop(control, row) {
    const grid = control.closest('.circuit-grid');
    if (!grid || !control.matches('button')) return;
    if (row !== undefined) activeCircuitRow = row;
    else if (activeCircuitGrid !== grid || control.tabIndex !== 0) activeCircuitRow = Number(control.dataset.navRow);
    activeCircuitGrid = grid;
    for (const button of grid.querySelectorAll('button')) button.tabIndex = button === control ? 0 : -1;
  }

  function gatePayload(element) {
    const operation = location(element);
    const rule = getCircuit(operation.ruleId);
    return { generator: rule[operation.side].find(gate => gate.id === operation.id).generator, operation };
  }

  function placedDraft(payload, target, wire = Number(target.dataset.wire)) {
    const scalar = gates.scalarIds.has(payload.generator);
    if (target.hasAttribute('data-phase') && !scalar) throw new RangeError('Choose a global phase for this position.');
    if (scalar) wire = 0;
    const to = location(target);
    const insert = target.dataset.action === 'insert-gate';
    const position = Number(target.dataset[insert ? 'boundary' : 'column']);
    if (scalar && insert && !payload.operation && !target.hasAttribute('data-phase')) {
      const operations = getCircuit(to.ruleId)[to.side];
      const columns = getCircuitColumns(operations);
      const column = columns[Math.min(position, columns.length - 1)];
      if (column !== undefined && !operations.some(operation => operation.column === column && gates.scalarIds.has(operation.generator))) {
        return placeGate(draft, to.ruleId, to.side, payload.generator, 0, column);
      }
    }
    const place = insert ? insertGate : placeGate;
    return place(draft, to.ruleId, to.side, payload.generator, wire, position, payload.operation);
  }

  function closePicker(restoreFocus = false) {
    clearPlacementPreview();
    const target = pickerTarget;
    pickerTarget = null;
    target?.setAttribute('aria-expanded', 'false');
    if (picker.matches(':popover-open')) picker.hidePopover();
    if (restoreFocus && target?.isConnected) target.focus({ preventScroll: true });
  }

  function openPicker(target) {
    closePicker();
    const phase = target.hasAttribute('data-phase');
    const choices = gates.list.filter(generator => !phase || generator.arity === 0)
      .toSorted((a, b) => Number(b.arity === 0) - Number(a.arity === 0)).map(generator => {
      const choice = button('picker-generator', '', generator.name);
      choice.dataset.pickerGenerator = generator.id;
      choice.append(node('span', 'picker-name', displayName(generator.name)), node('span', 'picker-arity', generator.arity === 0 ? 'Global phase' : `${generator.arity} ${generator.arity === 1 ? 'wire' : 'wires'}`));
      for (const wire of [...placementWires(generator, target), Number(target.dataset.wire)]) {
        if (validateChoice(choice, () => placedDraft({ generator: generator.id }, target, wire))) break;
      }
      return choice;
    });
    const firstGate = choices.findIndex(choice => !gates.scalarIds.has(choice.dataset.pickerGenerator));
    const content = [...choices];
    if (firstGate > 0) {
      content.unshift(node('div', 'picker-heading picker-phase-heading', 'Global phases'));
      content.splice(firstGate + 1, 0, node('div', 'picker-heading picker-section-heading', 'Gates'));
    }
    displayPicker(target, choices, phase || (choices.length > 0 && firstGate < 0) ? 'Add global phase' : draft.structure === 'PRO' ? 'Add generator' : 'Add operation',
      choices.length ? 'No operations fit here.' : phase ? 'Add a generator with 0 wires first.' : 'Add a generator first.', content);
  }

  function placementWires(generator, target) {
    if (generator.arity === 0) return [0];
    if (generator.arity <= 1) return [Number(target.dataset.wire)];
    const wires = getCircuit(location(target).ruleId).wires;
    return Array.from({ length: Math.max(0, wires - generator.arity + 1) }, (_, wire) => wire);
  }

  function openWirePicker(target, generator) {
    const choices = placementWires(generator, target).map(wire => {
      const choice = button('picker-generator', `Wires ${wire + 1}–${wire + generator.arity}`);
      choice.dataset.pickerGenerator = generator.id;
      choice.dataset.placementWire = String(wire);
      validateChoice(choice, () => placedDraft({ generator: generator.id }, target, wire));
      return choice;
    });
    const back = button('picker-back', '← Back');
    back.dataset.action = 'back-generators';
    displayPicker(target, choices, `Place ${generator.name}`, 'No wires are available.', [back, node('div', 'picker-heading', displayName(generator.name)), ...choices]);
    const preferred = choices.filter(choice => !choice.disabled).sort((a, b) =>
      Math.abs(Number(a.dataset.placementWire) - Number(target.dataset.wire)) - Math.abs(Number(b.dataset.placementWire) - Number(target.dataset.wire)))[0];
    focusPickerControl(preferred);
  }

  function clearPlacementPreview() {
    for (const slot of root.querySelectorAll('[data-placement]')) slot.removeAttribute('data-placement');
    for (const grid of root.querySelectorAll('[data-insert-preview]')) grid.removeAttribute('data-insert-preview');
    for (const gate of root.querySelectorAll('[data-preview]')) gate.removeAttribute('data-preview');
  }

  function previewPlacement(choice) {
    choice ??= picker.contains(document.activeElement) ? document.activeElement.closest('[data-placement-wire], [data-control-wire]') : null;
    clearPlacementPreview();
    if (!choice || choice.disabled || !pickerTarget) return;
    if (choice.dataset.controlWire !== undefined) {
      const from = controlBody(pickerTarget);
      const operations = getCircuit(from.ruleId)[from.side].filter(operation => !from.ids || from.ids.includes(operation.id));
      const side = pickerTarget.closest('[data-side]');
      for (const operation of operations) side.querySelector(`[data-operation-id="${CSS.escape(operation.id)}"]`).dataset.preview = 'true';
      const wire = Number(choice.dataset.controlWire);
      if (!Number.isInteger(wire)) return;
      const columns = getCircuitColumns(getCircuit(from.ruleId)[from.side]);
      const first = columns.indexOf(Math.min(...operations.map(operation => operation.column)));
      const last = columns.indexOf(Math.max(...operations.map(operation => operation.column)));
      for (const slot of side.querySelectorAll('.insert-slot:not([data-phase])')) {
        if (Number(slot.dataset.wire) === wire && Number(slot.dataset.boundary) >= first && Number(slot.dataset.boundary) <= last + 1) slot.dataset.placement = String(wire + 1);
      }
      return;
    }
    const first = Number(choice.dataset.placementWire);
    const generator = gates.byId.get(choice.dataset.pickerGenerator);
    previewGate({ generator: generator.id }, pickerTarget, first);
  }

  function previewGate(payload, target, wire = Number(target.dataset.wire)) {
    const generator = gates.byId.get(payload.generator);
    if (generator.arity === 0) wire = 0;
    const side = target.closest('[data-side]');
    const grid = side.querySelector('.circuit-grid');
    const insert = target.dataset.action === 'insert-gate';
    const key = insert ? 'boundary' : 'column';
    const wires = new Set(Array.from({ length: generator.arity }, (_, index) => wire + index));
    if (payload.operation) {
      const operation = getCircuit(payload.operation.ruleId)[payload.operation.side].find(operation => operation.id === payload.operation.id);
      for (const control of operation.controls ?? []) wires.add(control.wire + wire - operation.wire);
    }
    for (const slot of grid.querySelectorAll('.circuit-slot')) {
      if (!slot.hasAttribute('data-phase') && slot.dataset.action === target.dataset.action && slot.dataset[key] === target.dataset[key] && wires.has(Number(slot.dataset.wire))) {
        slot.dataset.placement = String(Number(slot.dataset.wire) + 1);
      }
    }
    const operations = getCircuit(location(target).ruleId)[location(target).side];
    const columns = getCircuitColumns(operations);
    const neighboring = columns[Math.min(Number(target.dataset.boundary), columns.length - 1)];
    const sharedPhase = generator.arity === 0 && !payload.operation && !target.hasAttribute('data-phase') && neighboring !== undefined
      && !operations.some(operation => operation.column === neighboring && gates.scalarIds.has(operation.generator));
    if (insert && !sharedPhase) {
      grid.dataset.insertPreview = 'true';
      grid.style.setProperty('--insert-boundary', target.dataset.boundary);
    }
  }

  function controlBody(target) {
    const from = location(target);
    const chosen = selection.filter(operation => operation.ruleId === from.ruleId && operation.side === from.side);
    return { ...from, ids: chosen.length ? chosen.map(operation => operation.id) : undefined };
  }

  function controlledDraft(from, wire, value) {
    return controlCircuit(draft, from.ruleId, from.side, ['above', 'below'].includes(wire) ? wire : Number(wire), value, from.ids);
  }

  function validateChoice(choice, action) {
    choice.disabled = false;
    choice.removeAttribute('title');
    choice.removeAttribute('aria-description');
    choice.querySelector('.picker-reason')?.remove();
    try { action(); return true; }
    catch (error) {
      choice.disabled = true;
      choice.title = error.message;
      choice.setAttribute('aria-description', error.message);
      choice.append(node('span', 'picker-reason', error.message));
      return false;
    }
  }

  function openControl(target) {
    closePicker();
    const from = controlBody(target);
    const rule = getCircuit(from.ruleId);
    const choices = [...Array.from({ length: rule.wires }, (_, wire) => [wire, `Wire ${wire + 1}`]), ['above', 'New wire above'], ['below', 'New wire below']].map(([wire, label]) => {
      const choice = button('picker-generator', label);
      choice.dataset.controlWire = String(wire);
      validateChoice(choice, () => controlledDraft(from, wire, 1));
      return choice;
    });
    const operations = rule[from.side].filter(operation => !from.ids || from.ids.includes(operation.id));
    if (operations.some(operation => operation.controls?.length)) {
      const clear = button('picker-generator', 'Remove controls');
      clear.dataset.action = 'remove-controls';
      choices.push(clear);
    }
    const extras = [node('div', 'picker-heading', from.ids ? `Control ${from.ids.length} selected ${from.ids.length === 1 ? 'gate' : 'gates'}` : 'Control circuit')];
    if (draft.structure === 'Polycontrolled PROP') {
      const label = node('label', 'control-value');
      const values = node('select');
      values.id = 'control-value';
      values.setAttribute('aria-label', 'Control value');
      for (let value = 0; value < draft.controlValues; value++) values.append(new Option(String(value), String(value)));
      values.value = '1';
      label.append(node('span', '', 'Value'), values);
      extras.push(label);
    }
    displayPicker(target, choices, from.ids ? 'Control selected gates' : 'Control circuit', 'No control wires are available.', [...extras, ...choices]);
    focusPickerControl(get('control-value'));
  }

  function displayPicker(target, choices, label, emptyText, content = choices) {
    get('generator-choices').replaceChildren(...content);
    const firstEnabled = choices.find(choice => !choice.disabled);
    get('generator-picker-empty').hidden = Boolean(firstEnabled);
    get('generator-picker-empty').textContent = emptyText;
    picker.setAttribute('aria-label', label);
    pickerTarget = target;
    target.setAttribute('aria-expanded', 'true');
    if (!picker.matches(':popover-open')) picker.showPopover();
    positionPicker();
    focusPickerControl(firstEnabled ?? get('close-generator-picker'));
  }

  function focusPickerControl(control) {
    if (!control) return;
    control.focus({ preventScroll: true });
    const bounds = control.getBoundingClientRect(), viewport = picker.getBoundingClientRect();
    if (bounds.top < viewport.top + 6) picker.scrollTop -= viewport.top + 6 - bounds.top;
    else if (bounds.bottom > viewport.bottom - 6) picker.scrollTop += bounds.bottom - viewport.bottom + 6;
  }

  function positionPicker() {
    if (!pickerTarget || !picker.matches(':popover-open')) return;
    const anchor = pickerTarget.getBoundingClientRect(), size = picker.getBoundingClientRect();
    if (!pickerTarget.isConnected) {
      closePicker();
      return;
    }
    picker.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - size.width - 8))}px`;
    const top = anchor.bottom + 6 + size.height <= innerHeight - 8 ? anchor.bottom + 6 : anchor.top - size.height - 6;
    picker.style.top = `${Math.max(8, Math.min(top, innerHeight - size.height - 8))}px`;
  }

  picker.addEventListener('toggle', () => { if (!picker.matches(':popover-open')) closePicker(); });
  picker.addEventListener('focusin', event => previewPlacement(event.target.closest('[data-placement-wire], [data-control-wire]')));
  picker.addEventListener('pointerover', event => {
    if (event.pointerType !== 'touch') previewPlacement(event.target.closest('[data-placement-wire], [data-control-wire]'));
  });
  picker.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') previewPlacement(); });
  picker.addEventListener('focusout', event => { if (event.relatedTarget && !picker.contains(event.relatedTarget)) closePicker(); });
  picker.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.target.closest('select') && event.key !== 'Escape') return;
    if (event.key === 'Escape') { event.preventDefault(); closePicker(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const choices = [...picker.querySelectorAll('button:not(:disabled)')];
      const index = choices.indexOf(document.activeElement), step = event.key === 'ArrowUp' ? -1 : 1;
      focusPickerControl(choices[event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + step + choices.length) % choices.length]);
    }
  });
  window.addEventListener('resize', positionPicker);
  window.addEventListener('scroll', event => { if (event.target instanceof Node && !picker.contains(event.target)) positionPicker(); }, { capture: true, passive: true });

  function pressControl(event) {
    if (event.isPrimary !== false && event.button === 0) pressedControl = event.target.closest('button, input, select');
  }
  root.addEventListener('pointerdown', pressControl, { capture: true });
  root.addEventListener('mousedown', pressControl, { capture: true });
  root.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && event.target.matches('[data-field]')) tabbing = true;
  }, { capture: true });
  document.addEventListener('focusin', () => {
    const leavingSelect = pressedControl instanceof HTMLSelectElement && pressedControl !== document.activeElement;
    if (leavingSelect) pressedControl = null;
    if (!tabbing && !leavingSelect) return;
    tabbing = false;
    if (renderDeferred) render();
  });
  root.addEventListener('focusin', event => {
    makeCircuitTabStop(event.target);
    if (picker.contains(event.target) || event.target.closest('.minimality-heading')) return;
    const bounds = event.target.getBoundingClientRect();
    const toolbar = root.querySelector('.minimality-heading').getBoundingClientRect();
    if (bounds.top < Math.max(0, toolbar.bottom) + 8 || bounds.bottom > innerHeight - 8) event.target.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  function releaseControl(event) {
    if (event.isPrimary === false) return;
    if (event.type !== 'blur' && pressedControl instanceof HTMLSelectElement && pressedControl === document.activeElement) return;
    pressedControl = null;
    if (event.type === 'blur') tabbing = false;
    clearTimeout(renderTimer);
    if (renderDeferred && !dragPayload) renderTimer = setTimeout(render, 0);
  }
  window.addEventListener('pointerup', releaseControl);
  window.addEventListener('mouseup', releaseControl);
  window.addEventListener('pointercancel', releaseControl);
  window.addEventListener('blur', releaseControl);
  root.addEventListener('focusout', event => { if (event.target === pressedControl && event.target instanceof HTMLSelectElement) releaseControl(event); });

  root.addEventListener('click', event => {
    if (event.target.closest('select')) return;
    let target = event.target.closest('button');
    pressedControl = null;
    tabbing = false;
    if (renderDeferred) {
      const focusKey = target?.dataset.focusKey;
      render();
      if (target && !target.isConnected) target = focusKey ? root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`) : null;
    }
    if (!target) {
      if (event.target.closest('.equation-diagrams, .shortcut-diagrams')) { selection = []; updateSelection(); }
      return;
    }
    if (target.disabled) return;
    const action = target.dataset.action;
    const apply = action => edit(action, target);
    if (target.id === 'run-search') { if (requestController) requestController.abort('Stopped'); else run(); return; }
    if (target.id === 'save-theory') { download(); return; }
    if (requestController) return;
    if (target.id === 'close-generator-picker') { closePicker(true); return; }
    if (action === 'back-generators') { openPicker(pickerTarget); return; }
    const control = pickerTarget?.dataset.action === 'control-circuit' ? controlBody(pickerTarget) : null;
    if (target.dataset.controlWire !== undefined && control) {
      const value = Number(get('control-value')?.value ?? 1);
      const wire = target.dataset.controlWire;
      closePicker(true);
      apply(() => controlledDraft(control, wire, value));
      return;
    }
    if (action === 'remove-controls' && control) {
      closePicker(true);
      apply(() => removeControls(draft, control.ruleId, control.side, control.ids));
      return;
    }
    if (target.dataset.pickerGenerator) {
      const slot = pickerTarget, generatorId = target.dataset.pickerGenerator;
      const generator = gates.byId.get(generatorId);
      if (!slot?.isConnected || !generator) return;
      if (generator.arity > 1 && target.dataset.placementWire === undefined) { openWirePicker(slot, generator); return; }
      const wire = Number(target.dataset.placementWire ?? slot.dataset.wire);
      closePicker(true);
      selectedGenerator = generatorId;
      selection = [];
      apply(() => placedDraft({ generator: generatorId }, slot, wire));
      return;
    }
    if (target.id === 'add-generator') {
      apply(() => addGenerator(draft, { name: nextName('G', gates.list), arity: 1 }));
      const input = get('generator-list').lastElementChild?.querySelector('input');
      input?.focus(); input?.select();
    } else if (target.id === 'add-shortcut') {
      apply(() => addShortcut(draft, { name: nextName('S', gates.list), wires: gates.byId.get(selectedGenerator)?.arity ?? 1 }));
      get('shortcut-editors').open = true;
      const input = get('shortcut-list').lastElementChild?.querySelector('input');
      input?.focus(); input?.select();
    } else if (target.id === 'add-rule') {
      apply(() => addRule(draft, { name: nextName('E', draft.rules), wires: Math.max(draft.structure === 'PRO' ? 1 : 2, gates.byId.get(selectedGenerator)?.arity ?? 1) }));
      const input = get('rule-list').lastElementChild?.querySelector('input');
      input?.focus(); input?.select();
    } else if (target.id === 'new-theory') apply(createTheory);
    else if (target.id === 'reload-zoo') loadZoo();
    else if (target.id === 'open-theory') get('theory-file').click();
    else if (target.id === 'undo-theory' || target.id === 'redo-theory') travel(target.id === 'undo-theory');
    else if (action === 'select-generator') {
      selectedGenerator = target.closest('[data-generator-id]').dataset.generatorId;
      selection = [];
      updateSelection();
    } else if (action === 'remove-generator') {
      apply(() => removeGenerator(draft, target.closest('[data-generator-id]').dataset.generatorId));
    } else if (action === 'remove-rule') {
      apply(() => removeRule(draft, location(target).ruleId));
    } else if (action === 'remove-shortcut') {
      apply(() => removeShortcut(draft, location(target).ruleId));
    } else if (action === 'select-gate') {
      const payload = gatePayload(target);
      const from = payload.operation;
      const extend = selection.every(operation => operation.ruleId === from.ruleId && operation.side === from.side);
      selection = extend ? selection.some(operation => operation.id === from.id)
        ? selection.filter(operation => operation.id !== from.id) : [...selection, from] : [from];
      selectedGenerator = payload.generator;
      updateSelection();
    } else if (action === 'control-circuit') {
      openControl(target);
    } else if (action === 'delete-selection') {
      deleteSelected();
    } else if (action === 'place-gate' || action === 'insert-gate') {
      openPicker(target);
    }
  });

  root.addEventListener('input', event => {
    if (['rule-name', 'shortcut-name'].includes(event.target.dataset.field)) event.target.size = Math.max(1, event.target.value.length);
  });

  root.addEventListener('change', async event => {
    const target = event.target;
    if (requestController) return;
    if (target === pressedControl && target instanceof HTMLSelectElement) pressedControl = null;
    if (target.id === 'control-value' && pickerTarget?.dataset.action === 'control-circuit') {
      const control = controlBody(pickerTarget);
      for (const choice of picker.querySelectorAll('[data-control-wire]')) {
        validateChoice(choice, () => controlledDraft(control, choice.dataset.controlWire, Number(target.value)));
      }
      get('generator-picker-empty').hidden = Boolean(picker.querySelector('button:not(:disabled):not(.picker-close)'));
      return;
    }
    if (target.id === 'theory-file') {
      const file = target.files?.[0], ticket = ++importTicket;
      target.value = '';
      if (file) {
        try {
          if (file.size > LIMITS.bytes) throw new Error('Choose a theory file smaller than 256 KB.');
          const source = await file.text();
          if (ticket === importTicket && !requestController) commit(parseTheoryFile(source));
        } catch (error) { if (ticket === importTicket) message(error.message, get('open-theory')); }
      }
      return;
    }
    if (target.id === 'theory-zoo') {
      const entry = zooEntries?.get(target.value);
      target.value = '';
      if (entry?.draft) edit(() => entry.draft);
      return;
    }
    if (!target.dataset.field) return;
    const [kind, field] = target.dataset.field.split('-');
    const details = { [field]: ['name', 'structure'].includes(field) ? target.value : Number(target.value) };
    edit(() => kind === 'generator' ? updateGenerator(draft, target.closest('[data-generator-id]').dataset.generatorId, details)
      : kind === 'rule' ? updateRule(draft, location(target).ruleId, details)
      : kind === 'shortcut' ? updateShortcut(draft, location(target).ruleId, details) : { ...draft, ...details }, target);
  });

  root.addEventListener('dragstart', event => {
    closePicker();
    if (requestController) { event.preventDefault(); return; }
    const gate = event.target.closest('.gate-chip');
    const generator = event.target.closest('.generator-drag')?.closest('[data-generator-id]');
    if (gate) dragPayload = gatePayload(gate);
    else if (generator) dragPayload = { generator: generator.dataset.generatorId };
    else return;
    event.dataTransfer.setData('text/plain', dragPayload.generator);
    event.dataTransfer.effectAllowed = dragPayload.operation ? 'move' : 'copy';
  });

  root.addEventListener('dragover', event => {
    const cell = event.target.closest('.circuit-slot');
    if (!cell || !dragPayload || requestController) return;
    try {
      if (cell !== dropTarget) {
        placedDraft(dragPayload, cell);
        clearDrop();
        cell.setAttribute('data-drop', '');
        previewGate(dragPayload, cell);
        dropTarget = cell;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = dragPayload.operation ? 'move' : 'copy';
    } catch { clearDrop(); }
  });

  function clearDrop() { dropTarget?.removeAttribute('data-drop'); dropTarget = null; clearPlacementPreview(); }
  root.addEventListener('dragleave', event => { if (event.target.closest('.circuit-slot')) clearDrop(); });
  root.addEventListener('dragend', () => {
    dragPayload = null;
    clearDrop();
    pressedControl = null;
    if (renderDeferred) render();
  });
  root.addEventListener('drop', event => {
    const cell = event.target.closest('.circuit-slot');
    if (!cell || !dragPayload || requestController) return;
    event.preventDefault();
    edit(() => placedDraft(dragPayload, cell));
    dragPayload = null;
    clearDrop();
  });

  function travel(backwards) {
    const from = backwards ? history : future, to = backwards ? future : history;
    if (!from.length || requestController) return;
    to.push(draftSource);
    restore(from.pop());
  }

  root.addEventListener('keydown', event => {
    const grid = event.target.closest('.circuit-grid');
    const navigate = grid && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key);
    if (requestController || ignoresShortcut(event, Boolean(navigate))) return;
    if (navigate) {
      event.preventDefault();
      const buttons = [...grid.querySelectorAll('button:not(:disabled)')];
      const positions = buttons.map(control => ({ key: control.dataset.focusKey, column: Number(control.dataset.navColumn),
        row: Number(control.dataset.navRow), rowEnd: Number(control.dataset.navEnd ?? control.dataset.navRow) }));
      const next = moveCircuitFocus(positions, event.target.dataset.focusKey, event.key, activeCircuitRow);
      if (next) {
        const control = buttons.find(control => control.dataset.focusKey === next.key);
        makeCircuitTabStop(control, next.row);
        control.focus();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travel(!event.shiftKey); }
    if (event.key === 'Escape') { selection = []; updateSelection(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length) {
      event.preventDefault();
      deleteSelected();
    }
  });

  function deleteSelected() {
    if (!selection.length) return;
    const { ruleId, side } = selection[0];
    edit(() => removeGates(draft, ruleId, side, selection.map(operation => operation.id)));
  }

  function download() {
    const filename = `${draft.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'theory'}.minimality.json`;
    downloadBlob(new Blob([draftSource], { type: 'application/json' }), filename);
  }

  function prepareResults(theory) {
    resultRows.clear();
    get('search-results').replaceChildren();
    for (const equation of theory.equations) {
      const row = node('li', 'result-row');
      row.dataset.state = 'pending';
      const name = node('span', 'result-name', displayName(equation.id));
      const state = node('span', 'result-state', 'Waiting');
      const detail = node('span', 'result-detail');
      row.append(name, state, detail);
      resultRows.set(equation.id, { row, state, detail });
      get('search-results').append(row);
    }
    get('search-error').hidden = true;
    get('search-source').hidden = true;
    get('search-progress').textContent = '';
    get('search-output').hidden = false;
  }

  function showWitness(witness) {
    const entry = resultRows.get(witness.equation);
    if (!entry || entry.row.dataset.state === 'found') return;
    entry.row.dataset.state = witness.certified ? 'found' : 'numerical';
    entry.state.textContent = witness.certified ? 'Certified independent' : 'Numerical evidence';
    const summary = summarizeWitness(witness);
    entry.detail.textContent = summary.detail;
    entry.row.querySelector('details')?.remove();
    const details = node('details', 'witness-details');
    details.append(node('summary', '', 'Witness'));
    const facts = node('dl', 'witness-facts');
    const fact = (name, value) => facts.append(node('dt', '', name), node('dd', '', value));
    fact('Method', summary.label);
    const parameters = witness.parameters ?? {};
    if (Array.isArray(parameters.generators)) fact('Generators', parameters.generators.map(displayName).join(', '));
    if (Object.keys(parameters.weights ?? {}).length) fact('Weights', Object.entries(parameters.weights).map(([name, weight]) => `${displayName(name)} ↦ ${weight}`).join(', '));
    if (parameters.swap) fact('Swap weight', String(parameters.swap));
    if (parameters.degree) fact('Degree', String(parameters.degree));
    if (parameters.interpretation?.generators) {
      for (const [name, value] of Object.entries(parameters.interpretation.generators)) fact(displayName(name), formatWitnessValue(value));
    }
    fact('Left', formatWitnessValue(witness.lhs_value));
    fact('Right', formatWitnessValue(witness.rhs_value));
    fact('Preserves', witness.checked_equations?.map(displayName).join(', ') || 'No other equations');
    details.append(facts);
    entry.row.append(details);
    updateSummary();
  }

  function updateSummary() {
    const found = [...resultRows.values()].filter(entry => entry.row.dataset.state === 'found').length;
    get('search-summary').textContent = `${found} / ${resultRows.size} certified independent`;
  }

  function finishPending(label) {
    for (const entry of resultRows.values()) {
      if (entry.row.dataset.state !== 'pending') continue;
      entry.row.dataset.state = 'unresolved';
      entry.state.textContent = label;
    }
  }

  async function run() {
    closePicker();
    let theory;
    try { theory = exportTheory(draft); }
    catch (error) { message(error.message, get('run-search')); return; }
    importTicket++;
    requestController = new AbortController();
    const limit = Number(get('search-timeout').value);
    const deadline = setTimeout(() => requestController?.abort(), 95_000);
    prepareResults(theory);
    lockEditor();
    get('search-heading').scrollIntoView({ block: 'start' });
    message('');
    get('search-summary').textContent = 'Connecting…';
    try {
      const response = await fetch('/api/minimality', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theory, timeout: limit }), signal: requestController.signal,
      });
      const report = await consumeSearchStream(response, {
        signal: requestController.signal,
        onEvent(event) {
          if (event.type === 'status') get('search-progress').textContent = event.message ?? '';
          if (event.type === 'source') {
            const source = get('search-source');
            const local = event.local;
            source.textContent = local ? 'minimality-auto · local' : `minimality-auto · ${String(event.commit).slice(0, 7)}`;
            source.href = local ? 'https://github.com/Sukyn/minimality-auto/' : `https://github.com/Sukyn/minimality-auto/commit/${encodeURIComponent(event.commit)}`;
            source.hidden = false;
            get('search-summary').textContent = 'Searching…';
          }
          if (event.type === 'witness') showWitness(event.witness);
        },
      });
      for (const witness of Object.values(report.witnesses ?? {})) showWitness(witness);
      finishPending(report.timed_out ? 'No witness within time limit' : 'No witness found');
      updateSummary();
      get('search-progress').textContent = `${report.timed_out ? 'Time limit reached' : 'Finished'} · ${Number(report.elapsed_seconds).toFixed(2)} s`;
    } catch (error) {
      const stopped = requestController.signal.reason === 'Stopped';
      finishPending(stopped ? 'Stopped' : 'Unresolved');
      updateSummary();
      if (stopped) {
        get('search-progress').textContent = 'Stopped';
        get('search-summary').textContent += ' · stopped';
      } else {
        get('search-error').textContent = error.name === 'AbortError' ? 'The request timed out. Try again.' : error.message;
        get('search-error').hidden = false;
        get('search-progress').textContent = 'Search interrupted';
      }
    } finally {
      clearTimeout(deadline);
      requestController = null;
      lockEditor();
    }
  }

  window.addEventListener('pagehide', () => { requestController?.abort(); zooController?.abort(); });
  const toolbar = root.querySelector('.minimality-heading');
  new ResizeObserver(() => root.style.setProperty('--workspace-toolbar-height', `${toolbar.getBoundingClientRect().height}px`)).observe(toolbar);
  render();
  loadZoo();
}
