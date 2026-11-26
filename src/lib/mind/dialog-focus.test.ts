import assert from "node:assert/strict";
import { test } from "node:test";
import { dialogFocusableElements, dialogTabTarget } from "./dialog-focus.ts";

test("modal Tab boundaries wrap in both directions without changing ordinary interior movement", () => {
  const controls = ["name", "description", "cancel", "create"];
  assert.equal(dialogTabTarget(controls, "create", false), "name");
  assert.equal(dialogTabTarget(controls, "name", true), "create");
  assert.equal(dialogTabTarget(controls, "description", false), undefined);
  assert.equal(dialogTabTarget(controls, "cancel", true), undefined);
});

test("a modal recovers focus from its container or a removed control using the current control list", () => {
  const controls = ["name", "cancel"];
  assert.equal(dialogTabTarget(controls, null, false), "name");
  assert.equal(dialogTabTarget(controls, "removed-create", false), "name");
  assert.equal(dialogTabTarget(controls, "removed-create", true), "cancel");
  assert.equal(dialogTabTarget(controls, "cancel", false), "name");
});

test("single-control and busy empty dialogs retain keyboard focus without invoking any action", () => {
  const control = { id: "cancel", invoked: false };
  assert.equal(dialogTabTarget([control], control, false), control);
  assert.equal(dialogTabTarget([control], control, true), control);
  assert.equal(dialogTabTarget([], null, false), null);
  assert.equal(dialogTabTarget([], null, true), null);
  assert.equal(control.invoked, false);
});

test("current dialog controls exclude disabled, hidden and inert entries and respect positive tab order", () => {
  const node = (id: string, options: { disabled?: boolean; hidden?: boolean; inert?: boolean; tabIndex?: number; invisible?: boolean } = {}) => ({
    id, tabIndex: options.tabIndex ?? 0, isContentEditable: false,
    matches: () => options.disabled === true,
    closest: () => options.inert ? {} : null,
    hasAttribute: () => options.tabIndex !== undefined,
    getClientRects: () => options.hidden ? [] : [{}],
    visibility: options.invisible ? "hidden" : "visible",
  });
  const nodes = [node("first"), node("disabled", { disabled: true }), node("hidden", { hidden: true }), node("inert", { inert: true }), node("negative", { tabIndex: -1 }), node("invisible", { invisible: true }), node("explicit-first", { tabIndex: 1 }), node("last")];
  const root = { querySelectorAll: () => nodes, ownerDocument: { defaultView: { getComputedStyle: (element: { visibility: string }) => ({ visibility: element.visibility }) } } } as unknown as HTMLElement;
  assert.deepEqual(dialogFocusableElements(root).map((element) => element.id), ["explicit-first", "first", "last"]);
  nodes[0].getClientRects = () => [];
  assert.deepEqual(dialogFocusableElements(root).map((element) => element.id), ["explicit-first", "last"]);
});
