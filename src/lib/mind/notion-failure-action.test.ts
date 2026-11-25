import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HONEST_FAILURE_MESSAGES,
  STOPPED_REPLY,
  classifyHonestFailure,
  shouldShowFailureBanner,
} from "./failure-states.ts";
import { NOTION_SETUP, notionConnection, type NotionTurn } from "./notion.ts";
import { OAUTH_STATUS_FETCH_TIMEOUT_MS } from "./service-board-status.ts";
import {
  NOTION_COMMAND_APP_MOUNT,
  NOTION_COMMAND_TIMEOUT_MS,
  NotionFailureBanner,
  NotionUnconfiguredNoticeBanner,
  notionFailureFromCatch,
  notionFailureFromTurn,
  notionFailureLogHref,
  notionFailureMountHint,
  notionOutcomeFromStatus,
  onceRetry,
  snapshotNotionFailureParams,
  withNotionCommandTimeout,
  type NotionFailureParams,
} from "./notion-failure-action.ts";

function turn(partial: Partial<NotionTurn> & Pick<NotionTurn, "ok" | "state" | "error">): NotionTurn {
  return {
    action: "search",
    needsConfirmation: false,
    ambiguous: false,
    pages: [],
    content: "",
    wrote: false,
    verified: false,
    ...partial,
  };
}

/** Same shape callNotion puts on a failed HTTP response. */
function apiError(status: number, bodyMessage?: string): string {
  const message = bodyMessage ?? `Notion returned ${status}.`;
  return `${message} Nothing was invented.`;
}

const searchParams = (): NotionFailureParams => ({
  text: "Search my Notion for roadmap",
  confirmed: false,
  pageId: "page-1",
  surface: "chat",
});

describe("H33 Notion connector failure banners", () => {
  it("uses the real not-configured and disconnected sentences", () => {
    assert.equal(HONEST_FAILURE_MESSAGES.notion_not_configured, NOTION_SETUP);
    assert.equal(notionConnection(undefined, false).detail, HONEST_FAILURE_MESSAGES.notion_not_configured);
    assert.equal(notionConnection("secret", true).detail, HONEST_FAILURE_MESSAGES.notion_disconnected);
    const token = "ntn_live_token_should_not_leak";
    assert.equal(JSON.stringify(notionConnection(token, true)).includes(token), false);
    assert.equal(JSON.stringify(notionConnection(token, false)).includes(token), false);
  });

  it("missing token is a Setup notice, never a silent empty and never a Retry", () => {
    const outcome = notionFailureFromTurn(
      turn({ ok: false, state: "unconfigured", error: NOTION_SETUP }),
      searchParams(),
    );
    assert.equal(outcome.tone, "unconfigured");
    if (outcome.tone !== "unconfigured") return;
    assert.equal(outcome.notice.message, NOTION_SETUP);
    assert.equal(outcome.notice.state, "unconfigured");
    assert.equal(shouldShowFailureBanner(outcome.notice.message), false);
    assert.equal(classifyHonestFailure(outcome.notice.message), null);
    const html = renderToStaticMarkup(
      createElement(NotionUnconfiguredNoticeBanner, {
        notice: outcome.notice,
        onConfigure: () => undefined,
      }),
    );
    assert.match(html, /data-testid="notion-unconfigured-notice"/);
    assert.match(html, /role="status"/);
    assert.match(html, /data-testid="notion-configure"/);
    assert.match(html, />Setup</);
    assert.match(html, /Open Plugins/);
    assert.doesNotMatch(html, /role="alert"/);
    assert.doesNotMatch(html, /data-testid="failure-retry"/);
    assert.doesNotMatch(html, /data-testid="failure-banner"/);
  });

  it("an empty unconfigured detail still shows the configure sentence", () => {
    const outcome = notionOutcomeFromStatus(
      { state: "unconfigured", detail: "  " },
      { text: "", confirmed: false, pageId: null, surface: "status" },
    );
    assert.equal(outcome.tone, "unconfigured");
    if (outcome.tone !== "unconfigured") return;
    assert.equal(outcome.notice.message, HONEST_FAILURE_MESSAGES.notion_not_configured);
    assert.ok(outcome.notice.message.length > 0);
  });

  it("owner disconnect is a notice, not an API failure", () => {
    const outcome = notionFailureFromTurn(
      turn({ ok: false, state: "disconnected", error: HONEST_FAILURE_MESSAGES.notion_disconnected }),
      searchParams(),
    );
    assert.equal(outcome.tone, "unconfigured");
    if (outcome.tone !== "unconfigured") return;
    assert.equal(outcome.notice.state, "disconnected");
    assert.equal(shouldShowFailureBanner(outcome.notice.message), false);
  });

  it("a null status probe is a visible failure, not a silent empty", () => {
    const outcome = notionOutcomeFromStatus(null, { text: "", confirmed: false, pageId: null, surface: "status" });
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.equal(outcome.failure.message, HONEST_FAILURE_MESSAGES.notion_status_failed);
    assert.equal(shouldShowFailureBanner(outcome.failure.message), true);
  });

  it("401/403/404/5xx keep the one-line server reason on a red Retry banner", () => {
    for (const status of [401, 403, 404, 500, 503]) {
      const error = apiError(status);
      const outcome = notionFailureFromTurn(turn({ ok: false, state: "connected", error }), searchParams());
      assert.equal(outcome.tone, "failure", error);
      if (outcome.tone !== "failure") continue;
      assert.equal(outcome.failure.kind, "notion_failed");
      assert.equal(outcome.failure.message, error);
      assert.equal(outcome.failure.auditAction, "notion_failed");
      assert.equal(shouldShowFailureBanner(outcome.failure.message), true);
      assert.match(outcome.failure.message, new RegExp(`Notion returned ${status}`));
    }
    const reasoned = notionFailureFromTurn(
      turn({ ok: false, state: "connected", error: apiError(401, "API token is invalid.") }),
      searchParams(),
    );
    assert.equal(reasoned.tone, "failure");
    if (reasoned.tone !== "failure") return;
    assert.match(reasoned.failure.message, /API token is invalid/);
    assert.match(reasoned.failure.message, /Nothing was invented/);
    assert.equal(reasoned.failure.kind, "notion_failed");
    assert.doesNotMatch(reasoned.failure.message, /\n/);
  });

  it("429 is a red rate-limit banner and Retry resends the identical call once", () => {
    const live = searchParams();
    const outcome = notionFailureFromTurn(
      turn({ ok: false, state: "connected", error: apiError(429) }),
      live,
    );
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.equal(outcome.failure.kind, "rate_limited");
    assert.equal(outcome.failure.auditAction, "rate_limited");
    assert.equal(outcome.failure.message, "Notion returned 429. Nothing was invented.");
    live.text = "changed";
    live.confirmed = true;
    live.pageId = "other";
    const calls: NotionFailureParams[] = [];
    const retry = onceRetry(() => {
      calls.push(snapshotNotionFailureParams(outcome.failure.params));
    });
    assert.ok(retry);
    retry();
    retry();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      text: "Search my Notion for roadmap",
      confirmed: false,
      pageId: "page-1",
      surface: "chat",
    });
    const html = renderToStaticMarkup(
      createElement(NotionFailureBanner, {
        failure: outcome.failure,
        auditId: "11111111-2222-4333-8444-555555555555",
        onRetry: retry,
        onViewLog: () => undefined,
      }),
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /data-testid="failure-banner"/);
    assert.match(html, /border-danger\/40/);
    assert.match(html, /data-failure-kind="rate_limited"/);
    assert.match(html, /data-testid="failure-retry"/);
    assert.match(html, /href="#audit-11111111-2222-4333-8444-555555555555"/);
    assert.match(html, />View log</);
    assert.equal(notionFailureLogHref("11111111-2222-4333-8444-555555555555"), "#audit-11111111-2222-4333-8444-555555555555");
  });

  it("Retry of a 404 re-executes notionCommand with the same text, confirmed, and pageId", () => {
    const params = snapshotNotionFailureParams({
      text: "Read the Notion page about roadmap",
      confirmed: true,
      pageId: "p1",
      surface: "chat",
    });
    const outcome = notionFailureFromTurn(
      turn({ ok: false, state: "connected", action: "read", error: apiError(404) }),
      params,
    );
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    const seen: Array<{ text: string; confirmed: boolean; pageId: string | null }> = [];
    const retry = onceRetry(() => {
      const next = outcome.failure.params;
      seen.push({ text: next.text, confirmed: next.confirmed, pageId: next.pageId });
    });
    retry?.();
    retry?.();
    assert.deepEqual(seen, [{ text: params.text, confirmed: true, pageId: "p1" }]);
    const html = renderToStaticMarkup(
      createElement(NotionFailureBanner, {
        failure: outcome.failure,
        auditId: "deadbeef",
        onRetry: () => undefined,
      }),
    );
    assert.match(html, /href="#audit-deadbeef"/);
    assert.match(html, /Notion returned 404/);
    assert.equal(notionFailureLogHref("not a valid id"), null);
  });

  it("a stuck call times out only after the connector budget; a fast call does not", async () => {
    assert.equal(NOTION_COMMAND_TIMEOUT_MS, OAUTH_STATUS_FETCH_TIMEOUT_MS);
    assert.equal(await withNotionCommandTimeout(async () => "pages", 200), "pages");
    await assert.rejects(
      () => withNotionCommandTimeout(() => new Promise(() => undefined), 25),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "TimeoutError");
        assert.equal(err.message, HONEST_FAILURE_MESSAGES.notion_timeout);
        return true;
      },
    );
    const timed = notionFailureFromCatch(
      Object.assign(new Error(HONEST_FAILURE_MESSAGES.notion_timeout), { name: "TimeoutError" }),
      searchParams(),
    );
    assert.equal(timed.tone, "failure");
    if (timed.tone !== "failure") return;
    assert.equal(timed.failure.kind, "notion_failed");
    assert.equal(timed.failure.message, HONEST_FAILURE_MESSAGES.notion_timeout);
    assert.equal(shouldShowFailureBanner(timed.failure.message), true);
    const aborted = notionFailureFromCatch(
      Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
      searchParams(),
    );
    assert.equal(aborted.tone, "failure");
    if (aborted.tone !== "failure") return;
    assert.notEqual(aborted.failure.message, HONEST_FAILURE_MESSAGES.notion_timeout);
    assert.match(aborted.failure.message, /aborted/);
  });

  it("network and status failures stay honest", () => {
    const network = notionFailureFromCatch(new TypeError("Failed to fetch"), searchParams());
    assert.equal(network.tone, "failure");
    if (network.tone !== "failure") return;
    assert.equal(network.failure.message, HONEST_FAILURE_MESSAGES.notion_unreachable);
    const status = notionFailureFromCatch(new Error(""), { text: "", confirmed: false, pageId: null, surface: "status" });
    assert.equal(status.tone, "failure");
    if (status.tone !== "failure") return;
    assert.equal(status.failure.message, HONEST_FAILURE_MESSAGES.notion_status_failed);
  });

  it("intentional Stop is user_stopped and not a red banner", () => {
    const caught = notionFailureFromCatch(new Error(STOPPED_REPLY), searchParams());
    assert.equal(caught.tone, "user_stopped");
    if (caught.tone !== "user_stopped") return;
    assert.equal(caught.message, STOPPED_REPLY);
    assert.equal(shouldShowFailureBanner(caught.message), false);
    const fromTurn = notionFailureFromTurn(turn({ ok: false, state: "connected", error: STOPPED_REPLY }), searchParams());
    assert.equal(fromTurn.tone, "user_stopped");
  });

  it("confirmation, empty search, and ambiguous picks are not red failures", () => {
    const confirm = notionFailureFromTurn(
      turn({
        ok: false,
        state: "connected",
        action: "append",
        needsConfirmation: true,
        error: "Append to “Roadmap” only after you confirm. Nothing was written.",
        pages: [{ id: "p1", title: "Roadmap", url: "https://www.notion.so/p1", kind: "page" }],
      }),
      searchParams(),
    );
    assert.equal(confirm.tone, "needs_confirmation");
    const empty = notionFailureFromTurn(
      turn({ ok: true, state: "connected", error: "Notion returned no matching pages." }),
      searchParams(),
    );
    assert.equal(empty.tone, "ok");
    const ambiguous = notionFailureFromTurn(
      turn({
        ok: false,
        state: "connected",
        ambiguous: true,
        error: "More than one Notion result matches. Pick one. Nothing was changed.",
      }),
      searchParams(),
    );
    assert.equal(ambiguous.tone, "message");
  });

  it("a verify miss and an emergency stop are failures; emergency stop is not user_stopped", () => {
    const verify = notionFailureFromTurn(
      turn({
        ok: false,
        state: "connected",
        action: "append",
        error: "Notion accepted a write, but the text was not found when the page was read back.",
      }),
      { text: "Append today's priorities to the Notion page about roadmap", confirmed: true, pageId: "p1", surface: "chat" },
    );
    assert.equal(verify.tone, "failure");
    if (verify.tone !== "failure") return;
    assert.equal(verify.failure.kind, "notion_failed");
    const halted = notionFailureFromTurn(
      turn({ ok: false, state: "connected", error: "Emergency stop is on. Notion was not called." }),
      searchParams(),
    );
    assert.equal(halted.tone, "failure");
    if (halted.tone !== "failure") return;
    assert.equal(halted.failure.kind, "emergency_stop_active");
    assert.notEqual(halted.failure.kind, "user_stopped");
    assert.equal(shouldShowFailureBanner(halted.failure.message), true);
  });

  it("API reject reported as unconfigured state stays a red failure", () => {
    const outcome = notionFailureFromTurn(
      turn({ ok: false, state: "unconfigured", error: "Notion credentials are present but the API rejected the token. Nothing was invented." }),
      searchParams(),
    );
    assert.equal(outcome.tone, "failure");
    if (outcome.tone !== "failure") return;
    assert.match(outcome.failure.message, /API rejected/);
    assert.equal(shouldShowFailureBanner(outcome.failure.message), true);
  });

  it("connected status is not a banner; mount snippet wires reportFailure, Setup, and #audit-", () => {
    const connected = notionOutcomeFromStatus(
      { state: "connected", detail: "Notion is connected on the server. The secret is not shown." },
      { text: "", confirmed: false, pageId: null, surface: "status" },
    );
    assert.equal(connected.tone, "connected");
    assert.match(notionFailureMountHint(), /notionFailureFromTurn/);
    assert.match(notionFailureMountHint(), /reportFailure/);
    assert.match(notionFailureMountHint(), /#audit-/);
    assert.match(notionFailureMountHint(), /user_stopped/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /withNotionCommandTimeout/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /onceRetry/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /shouldShowFailureBanner/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /setView\("connected"\)/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /#audit-/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /retryParams\.text/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /retryParams\.confirmed/);
    assert.match(NOTION_COMMAND_APP_MOUNT, /retryParams\.pageId/);
  });
});
