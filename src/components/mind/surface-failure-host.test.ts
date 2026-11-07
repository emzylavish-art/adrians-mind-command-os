import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { reportSurfaceFailure } from "./surface-failure-host.ts";
import { emitFailure, registerFailureHandler, type FailureSurface, type MountedFailure } from "../../lib/mind/failure-mount.ts";

const surfaces: FailureSurface[] = ["mcp", "notion", "research", "serviceBoard", "supabase", "persona", "modelRoute"];

describe("mounted failure surfaces", () => {
  it("fires the registered handler and leaves the existing alert hidden", () => {
    const outcome = { message: "Sol needs config. Missing SOL_API_KEY." };
    const seen: { current: MountedFailure<typeof outcome> | null } = { current: null };
    const unregister = registerFailureHandler("modelRoute", (payload: MountedFailure<unknown>) => {
      seen.current = payload as MountedFailure<typeof outcome>;
    });
    const selection = { provider: "sol", logicRoute: "sol" };
    const result = reportSurfaceFailure({
      surface: "modelRoute",
      message: outcome.message,
      outcome,
      retry: () => selection,
    });
    assert.equal(result.handled, true);
    assert.equal(result.visible, null);
    assert.equal(seen.current?.outcome, outcome);
    assert.deepEqual(seen.current?.retry(), selection);
    unregister();
  });

  it("keeps the existing alert when no handler is registered", () => {
    const outcome = { message: "Notion could not be reached. Nothing was changed." };
    assert.equal(emitFailure("notion", { outcome, retry: () => undefined, localCorrelationId: "local" }), false);
    const result = reportSurfaceFailure({
      surface: "notion",
      message: outcome.message,
      outcome,
      retry: () => undefined,
    });
    assert.equal(result.handled, false);
    assert.equal(result.visible, outcome.message);
  });

  it("command-app and the persona directory call emitFailure for every surface except speak", () => {
    const app = readFileSync(new URL("./command-app.tsx", import.meta.url), "utf8");
    const persona = readFileSync(new URL("./persona-directory.tsx", import.meta.url), "utf8");
    assert.match(app, /emitFailure\("notion"/);
    assert.match(app, /emitFailure\("research"/);
    assert.match(app, /emitFailure\("serviceBoard"/);
    assert.match(app, /emitFailure\(\s*surface/);
    assert.match(persona, /emitFailure\("persona"/);
    assert.equal(app.includes('emitFailure("speak"'), false);
    assert.equal(persona.includes('emitFailure("speak"'), false);
    for (const surface of surfaces) {
      const blob = `${app}\n${persona}`;
      if (surface === "persona") assert.match(blob, /emitFailure\("persona"/);
      else if (surface === "notion" || surface === "research" || surface === "serviceBoard") {
        assert.match(blob, new RegExp(`emitFailure\\("${surface}"`));
      }
    }
    assert.match(app, /surfaceForReport/);
  });
});
