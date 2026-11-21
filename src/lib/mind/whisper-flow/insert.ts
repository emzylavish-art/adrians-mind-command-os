/**
 * Insert transcript into the active text field at the caret.
 * Fires input events so React controlled inputs update. Never submits a form.
 */

export type InsertTarget =
  | { kind: "input"; el: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
  | { kind: "contenteditable"; el: HTMLElement }
  | { kind: "none" };

export function isEditableTarget(node: EventTarget | null): node is HTMLElement {
  if (!node || !(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLInputElement) {
    const type = (node.type || "text").toLowerCase();
    if (["button", "submit", "checkbox", "radio", "file", "hidden", "reset", "image"].includes(type)) {
      return false;
    }
    return !node.disabled && !node.readOnly;
  }
  if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
  if (node.isContentEditable) return true;
  return false;
}

/** Snapshot the focused editable when dictation starts. */
export function captureInsertTarget(doc: Document = document): InsertTarget {
  const active = doc.activeElement;
  if (!isEditableTarget(active)) return { kind: "none" };
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = typeof active.selectionStart === "number" ? active.selectionStart : active.value.length;
    const end = typeof active.selectionEnd === "number" ? active.selectionEnd : start;
    return { kind: "input", el: active, start, end };
  }
  return { kind: "contenteditable", el: active };
}

function joinWithSpace(before: string, insert: string, after: string): { value: string; caret: number } {
  const text = insert.trim();
  if (!text) return { value: before + after, caret: before.length };
  let prefix = before;
  let chunk = text;
  if (prefix && !/\s$/.test(prefix) && !/^[.,!?;:]/.test(chunk)) {
    chunk = ` ${chunk}`;
  }
  if (after && !/^\s/.test(after) && !/\s$/.test(chunk)) {
    // leave space decision to after side — do not force trailing space into insert
  }
  const value = `${prefix}${chunk}${after}`;
  return { value, caret: prefix.length + chunk.length };
}

export function insertTextAtCaret(
  target: InsertTarget,
  rawText: string,
  options?: { document?: Document },
): { ok: boolean; inserted: string; value?: string } {
  const text = rawText.trim();
  if (!text) return { ok: false, inserted: "" };
  if (target.kind === "none") return { ok: false, inserted: "" };

  if (target.kind === "input") {
    const el = target.el;
    // Prefer live selection if still focused on same element; else use snapshot.
    let start = target.start;
    let end = target.end;
    if (el === (options?.document ?? document).activeElement) {
      if (typeof el.selectionStart === "number") start = el.selectionStart;
      if (typeof el.selectionEnd === "number") end = el.selectionEnd;
    }
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const { value, caret } = joinWithSpace(before, text, after);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc?.set) desc.set.call(el, value);
    else el.value = value;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* some input types reject selection */
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    // Update snapshot caret for subsequent chunks.
    target.start = caret;
    target.end = caret;
    return { ok: true, inserted: text, value };
  }

  // contenteditable
  const el = target.el;
  el.focus();
  const doc = options?.document ?? document;
  const sel = doc.getSelection?.();
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = doc.createTextNode(text.startsWith(" ") || !range.startContainer.textContent ? text : ` ${text}`);
    // Prefer spaced insert when needed
    const needsSpace =
      range.startContainer.nodeType === Node.TEXT_NODE &&
      !!range.startContainer.textContent &&
      range.startOffset > 0 &&
      !/\s$/.test(range.startContainer.textContent.slice(0, range.startOffset));
    const insertNode = doc.createTextNode(needsSpace ? ` ${text}` : text);
    range.insertNode(insertNode);
    range.setStartAfter(insertNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    const needsSpace = el.textContent && !/\s$/.test(el.textContent);
    el.appendChild(doc.createTextNode(needsSpace ? ` ${text}` : text));
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return { ok: true, inserted: text, value: el.innerText };
}

/** Build the next string as if inserting at caret (pure; for tests / composer sync). */
export function computeInsertedValue(
  current: string,
  selectionStart: number,
  selectionEnd: number,
  transcript: string,
): { value: string; caret: number } {
  const before = current.slice(0, selectionStart);
  const after = current.slice(selectionEnd);
  return joinWithSpace(before, transcript, after);
}
