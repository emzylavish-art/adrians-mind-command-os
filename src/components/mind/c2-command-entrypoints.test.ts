import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { approvalTokenFor, decide } from "../../lib/mind/policy.ts";
import { emptyWorkspace } from "../../lib/mind/workspace.ts";
import { togglePin } from "../../lib/mind/fleet.ts";

const source = readFileSync(new URL("./command-app.tsx", import.meta.url), "utf8");
function actualHandler(start: string, end: string, context: Record<string, unknown>) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing actual handler ${start}`);
  return runInNewContext(`${stripTypeScriptTypes(source.slice(first, last))}\n${start.match(/function (\w+)/)![1]};`, context) as (...args: any[]) => any;
}

test("C2 AA056: the actual approval entry point accepts registered adapters and rejects unknown or halted actions", () => {
  for (const kind of ["tool", "notion-workspace", "notion-append", "mcp-call", "new_unregistered_adapter"]) {
    for (const halted of [false, true]) {
      let dispatched = 0;
      const errors: string[] = [];
      const ctx = { pending: { id: "exact-operation", kind, run: () => { dispatched++; } }, active: { autonomy: "automatic" }, autonomy: "automatic", ws: { halted }, decide, approvalTokenFor,
        setError: (error: string) => errors.push(error), setPending() {} };
      const confirm = actualHandler("  function confirmPending()", "  function recordToolTurn", ctx);
      confirm();
      const allowed = !halted && kind !== "new_unregistered_adapter";
      assert.equal(dispatched, Number(allowed), `${kind}, halted=${halted}`);
      if (!allowed) assert.equal(errors.length, 1);
    }
  }
});

test("C2 search pin control invokes the real workspace pin mutation and reports a full capacity accurately", () => {
  const start = source.indexOf("                    const before = wsRef.current;", source.indexOf('aria-label={`${pinned ? "Unpin" : "Pin"} ${hit.label}`}'));
  const end = source.indexOf("                  }}>", start);
  assert.ok(start >= 0 && end > start);
  const code = stripTypeScriptTypes(source.slice(start, end));
  let ws = emptyWorkspace();
  let notice = "";
  const hit = { ref: "chat-1", label: "Harbor" };
  const run = (pinned: boolean) => runInNewContext(code, { wsRef: { current: ws }, togglePin, kind: "chat", hit, pinned, setWs(value: typeof ws) { ws = value; }, setNotice(value: string) { notice = value; } });
  run(false);
  assert.equal(ws.pins[0]?.ref, "chat-1");
  assert.equal(notice, "Pinned Harbor.");
  run(true);
  assert.equal(ws.pins.length, 0);
  ws.pins = Array.from({ length: 24 }, (_, index) => ({ id: String(index), kind: "chat", ref: `existing-${index}` }));
  run(false);
  assert.equal(ws.pins.length, 24);
  assert.equal(notice, "Pin limit reached.");
});
