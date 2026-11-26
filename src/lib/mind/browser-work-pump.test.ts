import { test } from "node:test";
import assert from "node:assert/strict";
import { startBrowserWorkPump, type BrowserTimers } from "./browser-work-pump.ts";
import { subscribeVisibleClock } from "./visible-clock.ts";
import { emptyWorkspace } from "./workspace.ts";
import { addAgentFromTemplate, enqueueRun, tickFleet } from "./fleet.ts";

function fixture() {
  let now = 0, next = 0, visible = true;
  const jobs = new Map<number, { due: number; every: number; callback: () => void }>();
  const listeners = new Set<() => void>();
  const timers: BrowserTimers = {
    setTimeout(callback, ms) { const id = ++next; jobs.set(id, { due: now + ms, every: 0, callback }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    setInterval(callback, ms) { const id = ++next; jobs.set(id, { due: now + ms, every: ms, callback }); return id; },
    clearInterval(id) { jobs.delete(id); },
  };
  return {
    timers, now: () => now, visible: () => visible,
    subscribeVisibility(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    visibility(value: boolean) { visible = value; for (const listener of listeners) listener(); },
    advance(ms: number) {
      const end = now + ms;
      for (let attempts = 0; attempts < 1000; attempts++) {
        const next = [...jobs].filter(([, job]) => job.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, job] = next; now = job.due;
        if (job.every) job.due += job.every; else jobs.delete(id);
        job.callback();
      }
      now = end;
    },
    count: () => jobs.size,
  };
}

test("C1/AA068: enqueue wakes before the heartbeat, burst wakes coalesce and the real fleet advances once", () => {
  const time = fixture();
  const at = "2026-01-01T00:00:00.000Z";
  const made = addAgentFromTemplate(emptyWorkspace(), "Documents", at);
  if (!made.ok) throw new Error(made.error);
  made.agent.tools = ["list_projects"];
  const queued = enqueueRun(made.ws, made.agent.id, "List synthetic projects", at);
  if (!queued.ok) throw new Error(queued.error);
  let workspace = queued.ws, passes = 0;
  const pump = startBrowserWorkPump({ ...time, step() { passes++; workspace = tickFleet(workspace, { now: at, workerId: "fixture-browser" }); } });
  pump.wake(); pump.wake();
  time.advance(0);
  assert.equal(passes, 1);
  assert.notEqual(workspace.runs.find((run) => run.id === queued.run.id)?.state, "queued");
  assert.equal(time.now(), 0, "queued work must not wait for the two-second heartbeat");
  pump.dispose();
  time.advance(10_000);
  assert.equal(passes, 1);
  assert.equal(time.count(), 0);
});

test("C1/AA068: hidden work waits, visibility resumes promptly and old owner callbacks are disposed", () => {
  const time = fixture(); let a = 0, b = 0;
  time.visibility(false);
  const first = startBrowserWorkPump({ ...time, step: () => { a++; } });
  time.advance(10_000); assert.equal(a, 0);
  time.visibility(true); time.advance(0); assert.equal(a, 1);
  first.wake(); first.dispose();
  const second = startBrowserWorkPump({ ...time, step: () => { b++; } });
  time.advance(0); assert.equal(a, 1); assert.equal(b, 1);
  second.dispose(); assert.equal(time.count(), 0);
});

test("C1/AA066: visible presentation clocks stop in hidden tabs and resume from wall time without timer leaks", () => {
  const time = fixture(); const seen: number[] = [];
  const dispose = subscribeVisibleClock({ ...time, tick: (now) => seen.push(now) });
  time.advance(2000); assert.deepEqual(seen, [0, 1000, 2000]);
  time.visibility(false); assert.equal(time.count(), 0);
  time.advance(10_000); assert.deepEqual(seen, [0, 1000, 2000]);
  time.visibility(true); assert.equal(seen.at(-1), 12000);
  time.advance(1000); assert.equal(seen.at(-1), 13000);
  dispose(); time.advance(1000); assert.equal(seen.at(-1), 13000); assert.equal(time.count(), 0);
});
