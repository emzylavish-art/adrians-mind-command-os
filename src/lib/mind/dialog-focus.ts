/** Undefined keeps native movement inside a dialog; null focuses an empty dialog itself. */
export function dialogTabTarget<T>(controls: readonly T[], active: T | null, backwards: boolean): T | null | undefined {
  if (controls.length === 0) return null;
  const index = active === null ? -1 : controls.indexOf(active);
  if (index < 0) return backwards ? controls[controls.length - 1] : controls[0];
  if (backwards && index === 0) return controls[controls.length - 1];
  if (!backwards && index === controls.length - 1) return controls[0];
  return undefined;
}

/** Query again on each Tab so disabled/hidden controls and conditional content are current. */
export function dialogFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"]')]
    .filter((element) => !element.matches(":disabled") && !element.closest("[inert]") && (element.tabIndex >= 0 || (element.isContentEditable && !element.hasAttribute("tabindex"))) && element.getClientRects().length > 0 && dialog.ownerDocument.defaultView?.getComputedStyle(element).visibility !== "hidden")
    .sort((left, right) => (left.tabIndex > 0 ? left.tabIndex : Number.MAX_SAFE_INTEGER) - (right.tabIndex > 0 ? right.tabIndex : Number.MAX_SAFE_INTEGER));
}
