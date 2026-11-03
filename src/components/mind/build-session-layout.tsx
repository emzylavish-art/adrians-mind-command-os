import type { ReactNode } from "react";
/**
 * Codex / Grok Build–style live session chrome for Adrian's Mind Build view.
 * Presentational slots only. Renders from existing Build props when present;
 * otherwise a clearly labeled empty state. NO fake session / diff / plan data.
 */

export type BuildSessionStep = {
  id: string;
  title: string;
  detail?: string | null;
  status?: "pending" | "running" | "done" | "failed" | string;
};

export type BuildSessionLogRow = {
  id: string;
  tool: string;
  detail: string;
  ok?: boolean;
};

export type BuildSessionDiff = {
  id: string;
  path: string;
  additions: number;
  deletions: number;
};

export type BuildSessionLayoutProps = {
  /** Session goal / title when a build is active. */
  title?: string | null;
  /** Elapsed label from Logic Bot (e.g. "2m 30s"). Null → idle empty timer. */
  elapsedLabel?: string | null;
  /** True when a live session is running. */
  live?: boolean;
  /** Pairing / env chip text from existing Build props. */
  envLabel?: string | null;
  envDetail?: string | null;
  steps?: BuildSessionStep[] | null;
  logs?: BuildSessionLogRow[] | null;
  diffs?: BuildSessionDiff[] | null;
  summary?: string | null;
  summaryBullets?: string[] | null;
  testPlan?: string | null;
  /** Selected suggestion label (existing buildPick). */
  selectedSuggestion?: string | null;
  /** Optional sticky steer slot (composer wiring owned by Logic / Voice). */
  steerSlot?: ReactNode;
  /** Suggestions row (existing chips — pass-through). */
  suggestionsSlot?: ReactNode;
  /** Honesty banner / companion notice — pass-through. */
  noticeSlot?: ReactNode;
};

export function BuildSessionLayout({
  title = null,
  elapsedLabel = null,
  live = false,
  envLabel = null,
  envDetail = null,
  steps = null,
  logs = null,
  diffs = null,
  summary = null,
  summaryBullets = null,
  testPlan = null,
  selectedSuggestion = null,
  steerSlot = null,
  suggestionsSlot = null,
  noticeSlot = null,
}: BuildSessionLayoutProps) {
  const hasSession = Boolean(
    live ||
      elapsedLabel ||
      (steps && steps.length) ||
      (logs && logs.length) ||
      (diffs && diffs.length) ||
      summary ||
      testPlan,
  );

  return (
    <section
      className="build-session-shell"
      data-testid="build-session"
      aria-label="Build session"
    >
      <header className="build-session-header">
        <div className="build-session-header__title">
          <h2>{title?.trim() || (hasSession ? "Build session" : "Build")}</h2>
          <p>
            {hasSession
              ? "Live session chrome. Steps, diffs, and plans appear when Logic Bot streams them."
              : "No build session is running. This layout is ready for Logic Bot session data — nothing is simulated."}
          </p>
        </div>
        <div
          className="build-session-timer"
          data-testid="build-session-timer"
          data-live={live ? "true" : "false"}
          data-empty={elapsedLabel ? "false" : "true"}
          aria-live="polite"
        >
          <span className="build-session-timer__dot" aria-hidden="true" />
          {elapsedLabel ? (
            <span>Worked for {elapsedLabel}</span>
          ) : (
            <span>Elapsed — idle</span>
          )}
        </div>
      </header>

      <ul className="build-session-meta" aria-label="Build environment">
        <li>{envLabel?.trim() || "Not paired"}</li>
        {envDetail ? <li>{envDetail}</li> : null}
        {selectedSuggestion ? <li>Selected: {selectedSuggestion}</li> : null}
        {!hasSession ? <li>Empty session — no fake data</li> : null}
      </ul>

      {noticeSlot}

      <div className="build-session-grid">
        <div className="build-session-panel" data-testid="build-session-timeline">
          <p className="build-session-panel__label">Timeline</p>
          {steps && steps.length > 0 ? (
            <ol className="build-session-steps">
              {steps.map((step, index) => (
                <li key={step.id}>
                  <span className="build-session-steps__idx">{index + 1}</span>
                  <div className="build-session-steps__body">
                    <strong>{step.title}</strong>
                    {step.detail ? <span>{step.detail}</span> : null}
                    {step.status ? <span>{step.status}</span> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="build-session-empty" data-testid="build-timeline-empty">
              No steps yet. Logic Bot owns the session plan stream.
            </p>
          )}

          <p className="build-session-panel__label">Tools &amp; logs</p>
          {logs && logs.length > 0 ? (
            <ul className="build-session-log">
              {logs.map((row) => (
                <li key={row.id}>
                  <span className="build-session-log__tool">{row.tool}</span>
                  <span>
                    {row.ok === false ? "failed — " : row.ok === true ? "ok — " : ""}
                    {row.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="build-session-empty" data-testid="build-logs-empty">
              No tool or log rows. Rows appear when the session emits them.
            </p>
          )}
        </div>

        <div className="build-session-panel" data-testid="build-session-artifacts">
          <p className="build-session-panel__label">Diffs</p>
          {diffs && diffs.length > 0 ? (
            <div className="build-session-diffs">
              {diffs.map((diff) => (
                <article key={diff.id} className="build-session-diff">
                  <span className="build-session-diff__path">{diff.path}</span>
                  <span className="build-session-diff__counts" aria-label="Diff counts">
                    <span className="build-session-diff__add">+{diff.additions}</span>
                    <span className="build-session-diff__del">−{diff.deletions}</span>
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="build-session-empty" data-testid="build-diffs-empty">
              No diffs. ± counts will render here when Logic Bot / MCP provide file changes.
            </p>
          )}

          <p className="build-session-panel__label">Summary</p>
          {summary || (summaryBullets && summaryBullets.length > 0) ? (
            <div className="build-session-prose" data-testid="build-summary">
              {summary ? <p>{summary}</p> : null}
              {summaryBullets && summaryBullets.length > 0 ? (
                <ul>
                  {summaryBullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="build-session-empty" data-testid="build-summary-empty">
              Summary slot empty until the session produces one.
            </p>
          )}

          <p className="build-session-panel__label">Test plan</p>
          {testPlan ? (
            <p className="build-session-prose" data-testid="build-test-plan">
              {testPlan}
            </p>
          ) : (
            <p className="build-session-empty" data-testid="build-test-plan-empty">
              Test plan slot empty until Logic Bot emits a plan.
            </p>
          )}
        </div>
      </div>

      {suggestionsSlot ? (
        <div className="build-suggestions-row" data-testid="build-suggestions">
          {suggestionsSlot}
        </div>
      ) : null}

      <div className="build-session-steer" data-testid="build-session-steer">
        <p className="build-session-panel__label">Steer</p>
        <p className="build-session-steer__hint">
          Sticky steer channel for mid-build chat or voice. Logic Bot and Voice Wiring own the live session binding.
        </p>
        {steerSlot ? (
          steerSlot
        ) : (
          <div
            className="build-session-steer__box"
            role="note"
            aria-disabled="true"
            title="Coming soon — Logic Bot / Voice Wiring"
            data-testid="build-steer-empty"
          >
            Ask Adrian&apos;s Mind to steer this build… (@ files, / commands) — Coming soon
          </div>
        )}
      </div>
    </section>
  );
}
