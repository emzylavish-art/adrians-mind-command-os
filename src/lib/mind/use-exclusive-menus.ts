import { useMemo, useReducer } from "react";
import { CHROME_MENUS, reduceMenu, type ChromeMenuId, type MenuIntent } from "./menu-state.ts";

export function useExclusiveMenus() {
  const [current, dispatch] = useReducer(reduceMenu, null);
  const setters = useMemo(() => Object.fromEntries(CHROME_MENUS.map((id) => [id, (open: MenuIntent["open"]) => dispatch({ id, open })])) as Record<ChromeMenuId, (open: MenuIntent["open"]) => void>, []);
  return { current, bind: (id: ChromeMenuId) => [current === id, setters[id]] as const };
}
