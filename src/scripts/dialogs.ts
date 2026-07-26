type DialogBindingOptions = {
  marker: string;
  triggerAttribute: string;
  closeSelector?: string;
};

export function bindDialogControls({
  marker,
  triggerAttribute,
  closeSelector = "[data-offer-modal-close]",
}: DialogBindingOptions) {
  const state = window as typeof window & { [key: string]: boolean };
  if (state[marker]) return;
  state[marker] = true;

  function openDialog(id: string | null | undefined) {
    if (!id) return;
    const dialog = document.getElementById(`${id}-dialog`);
    if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
    dialog.showModal();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const trigger = target.closest(`[${triggerAttribute}]`);
    if (trigger instanceof HTMLElement) {
      event.preventDefault();
      openDialog(trigger.getAttribute(triggerAttribute));
      return;
    }

    const closeButton = target.closest(closeSelector);
    if (closeButton instanceof HTMLElement) {
      const dialog = closeButton.closest("dialog");
      if (dialog instanceof HTMLDialogElement) dialog.close();
      return;
    }

    if (target instanceof HTMLDialogElement) {
      const rect = target.getBoundingClientRect();
      const clickedBackdrop =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;

      if (clickedBackdrop) target.close();
    }
  });
}
