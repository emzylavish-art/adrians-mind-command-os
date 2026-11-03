import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DRAWER_SYSTEM_VIEWS,
  isPrimaryPointerActivate,
  selectDrawerView,
} from "./drawer-nav.ts";

describe("drawer-nav", () => {
  it("selectDrawerView sets the view before closing the drawer", () => {
    const calls: string[] = [];
    selectDrawerView({
      viewId: "settings",
      setView: (id) => calls.push(`view:${id}`),
      closeMenus: () => calls.push("menus"),
      closeDrawer: () => calls.push("drawer"),
    });
    assert.deepEqual(calls, ["view:settings", "menus", "drawer"]);
  });

  it("covers the phone drawer destinations that were reported stuck", () => {
    assert.deepEqual([...DRAWER_SYSTEM_VIEWS], [
      "scheduled",
      "memory",
      "activity",
      "settings",
    ]);
  });

  it("isPrimaryPointerActivate ignores non-primary mouse buttons", () => {
    assert.equal(isPrimaryPointerActivate({ pointerType: "touch" }), true);
    assert.equal(isPrimaryPointerActivate({ pointerType: "mouse", button: 0 }), true);
    assert.equal(isPrimaryPointerActivate({ pointerType: "mouse", button: 2 }), false);
  });

  it("simulates a mobile pointerup sequence that must change view even if click is lost", () => {
    let view = "command";
    let navOpen = true;
    const onPointerUp = () => {
      if (!isPrimaryPointerActivate({ pointerType: "touch" })) return;
      selectDrawerView({
        viewId: "memory",
        setView: (id) => {
          view = id;
        },
        closeDrawer: () => {
          navOpen = false;
        },
      });
    };
    // iOS often drops the synthesized click after the drawer unmounts.
    onPointerUp();
    assert.equal(view, "memory");
    assert.equal(navOpen, false);
  });
});
