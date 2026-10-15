function openDialog(id: string | null) {
  if (!id) return;
  const dialog = document.getElementById(`${id}-dialog`);
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  dialog.showModal();
}

// Imported once by ContentDialog, regardless of how many dialogs a page contains.
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const trigger = target.closest("[data-content-dialog]");
  if (trigger instanceof HTMLElement) {
    event.preventDefault();
    openDialog(trigger.getAttribute("data-content-dialog"));
    return;
  }

  const closeButton = target.closest("[data-modal-close]");
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
