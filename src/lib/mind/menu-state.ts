export const CHROME_MENUS = ["palette", "drawer", "surface", "controls", "nav-more", "context", "tools", "account", "notifications"] as const;
export type ChromeMenuId = typeof CHROME_MENUS[number];
export type MenuIntent = { id: ChromeMenuId; open: boolean | ((current: boolean) => boolean) };

/** A closing callback from a previous menu cannot dismiss the newly opened one. */
export function reduceMenu(current: ChromeMenuId | null, intent: MenuIntent): ChromeMenuId | null {
  const open = typeof intent.open === "function" ? intent.open(current === intent.id) : intent.open;
  return open ? intent.id : current === intent.id ? null : current;
}
