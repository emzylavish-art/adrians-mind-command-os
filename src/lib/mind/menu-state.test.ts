import assert from "node:assert/strict";
import { test } from "node:test";
import { CHROME_MENUS, reduceMenu, type ChromeMenuId } from "./menu-state.ts";

test("header and composer menus are exclusive while unrelated dialog state stays independent", () => {
  let current: ChromeMenuId | null = null;
  const dialog = { projectEditor: true, activeChat: "chat-a" };
  for (const id of CHROME_MENUS) {
    current = reduceMenu(current, { id, open: true });
    assert.equal(CHROME_MENUS.filter((name) => name === current).length, 1);
    assert.equal(current, id);
    assert.deepEqual(dialog, { projectEditor: true, activeChat: "chat-a" });
  }
  current = reduceMenu(current, { id: "account", open: true });
  current = reduceMenu(current, { id: "notifications", open: true });
  assert.equal(reduceMenu(current, { id: "account", open: false }), "notifications");
  assert.equal(reduceMenu(current, { id: "notifications", open: (open) => !open }), null);
});
