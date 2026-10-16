/** Keep replay buttons (and their focus) when only selection or metadata changes. */
export function createMoveTimeline(container, describe) {
  let rendered, locked = false, current;
  return function render(sequence, { step = null, disabled = false } = {}) {
    // Strings are immutable; unchanged Golf histories need no prefix scan.
    if (sequence !== rendered) {
      let shared = 0;
      while (shared < Math.min(rendered?.length ?? 0, sequence.length) && rendered[shared] === sequence[shared]) shared++;
      if (shared !== rendered?.length || shared !== sequence.length) {
        while (container.children.length > shared) container.lastElementChild.remove();
        if (shared < sequence.length) {
          const added = document.createDocumentFragment();
          for (let index = shared; index < sequence.length; index++) {
            const { text, label } = describe(sequence[index], index);
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.step = String(index + 1);
            button.textContent = text; button.disabled = disabled;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-current', 'false');
            added.appendChild(button);
          }
          container.appendChild(added);
        }
        // Move arrays grow and shrink in place; retain the rendered prefix separately.
        rendered = typeof sequence === 'string' ? sequence : [...sequence];
      }
    }
    if (locked !== disabled) {
      for (const button of container.children) button.disabled = disabled;
      locked = disabled;
    }
    const active = step === null ? null : container.children[step - 1];
    if (current !== active) {
      current?.setAttribute('aria-current', 'false');
      active?.setAttribute('aria-current', 'step');
      current = active;
    }
  };
}
