import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { classifyHonestFailure, HONEST_FAILURE_MESSAGES } from "./failure-states.ts";
import {
  SupabaseAccountFailureBanner,
  isRedirectLike,
  onceRetry,
  runSupabaseAccountProbe,
  runSupabaseSignOut,
  snapshotSupabaseAccountParams,
} from "./supabase-account-action.ts";

describe("Supabase account action failures", () => {
  it("classifies probe/sign-out markers as network_failure", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.supabase_account_probe_failed), "network_failure");
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.supabase_sign_out_failed), "network_failure");
  });

  it("honest configured:false is ok, not a banner", async () => {
    const result = await runSupabaseAccountProbe(async () => ({ configured: false, user: null }));
    assert.deepEqual(result, { ok: true, configured: false, email: null });
  });

  it("probe rejection shows red banner; Retry re-probes once", async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { configured: true, user: { email: "a@b.co" } };
    };
    let result = await runSupabaseAccountProbe(probe);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const html = renderToStaticMarkup(
      createElement(SupabaseAccountFailureBanner, {
        state: { status: "error", kind: result.kind, message: result.message, params: result.params },
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /failure-banner/);
    assert.match(html, /data-supabase-account-action="probe"/);

    const pending: Promise<Awaited<ReturnType<typeof runSupabaseAccountProbe>>>[] = [];
    const retry = onceRetry(() => {
      pending.push(runSupabaseAccountProbe(probe));
    });
    assert.ok(retry);
    retry!();
    retry!();
    assert.equal(pending.length, 1);
    result = await pending[0];
    assert.equal(calls, 2);
    assert.deepEqual(result, { ok: true, configured: true, email: "a@b.co" });
  });

  it("sign-out redirect throw is success, not a banner", async () => {
    const result = await runSupabaseSignOut(async () => {
      throw { isRedirect: true, to: "/login" };
    });
    assert.deepEqual(result, { ok: true, redirected: true });
    assert.equal(isRedirectLike({ isRedirect: true }), true);
    assert.equal(
      renderToStaticMarkup(
        createElement(SupabaseAccountFailureBanner, {
          state: { status: "ok" },
          onRetry: () => undefined,
        }),
      ),
      "",
    );
  });

  it("sign-out network failure keeps identical Retry params", async () => {
    const params = snapshotSupabaseAccountParams("sign_out");
    const result = await runSupabaseSignOut(async () => {
      throw new TypeError("Failed to fetch");
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(result.params, params);
    assert.match(result.message, /sign out could not be completed|network/i);
  });
});
