/**
 * Mobile drawer navigation helpers.
 *
 * The phone drawer is a full-viewport `fixed inset-0` aside. On iOS Safari a
 * `display:none` unmount (via `hidden`) between touchend and the synthesized
 * click cancels the click — so `onClick` never runs, the drawer appears to
 * "close" from another gesture, and `setView` never fires. Selecting the view
 * on pointerup (before close) keeps navigation reliable.
 */

export type DrawerNavSelectArgs = {
  viewId: string;
  setView: (viewId: string) => void;
  closeDrawer: () => void;
  closeMenus?: () => void;
};

/** Select an in-app view, then close the drawer. Safe to call from pointerup. */
export function selectDrawerView(args: DrawerNavSelectArgs): void {
  args.setView(args.viewId);
  args.closeMenus?.();
  args.closeDrawer();
}

/** True when the pointer event should activate a primary nav control. */
export function isPrimaryPointerActivate(event: {
  pointerType?: string;
  button?: number;
}): boolean {
  if (event.pointerType === "mouse" && (event.button ?? 0) !== 0) return false;
  return true;
}

/** Views Zack reported as broken on the phone drawer. */
export const DRAWER_SYSTEM_VIEWS = [
  "scheduled",
  "memory",
  "activity",
  "settings",
] as const;
