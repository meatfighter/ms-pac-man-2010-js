export function focusOwnedPanel(panel: HTMLElement, isCurrent: () => boolean): void {
    if (!isCurrent() || !panel.isConnected || !document.hasFocus()) return;
    const control = panel.matches("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)")
        ? panel
        : panel.querySelector<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled)");
    const target = control ?? panel;
    if (control === null && !panel.hasAttribute("tabindex")) panel.tabIndex = -1;
    target.focus({ preventScroll: true });
}
