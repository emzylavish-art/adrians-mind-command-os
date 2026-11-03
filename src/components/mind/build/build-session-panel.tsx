import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimelineEvent = {
  id: string;
  at: string;
  kind: string;
  text: string;
  stepId?: string;
  seq: number;
};

type PlanStep = {
  id: string;
  title: string;
  status: string;
  resolved?: { provider: string; model: string };
};

type PublicSession = {
  id: string;
  botId: string;
  goal: string;
  status: string;
  plan: PlanStep[];
  timeline: TimelineEvent[];
  startedAt: string;
  elapsedMs: number;
  summary: string;
  error: string;
  resolved?: { provider: string; model: string } | null;
  lastSeq: number;
  pendingSteerCount?: number;
};

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Presentational: pull +/- counts from a diff timeline line when Logic Bot emits them. */
function parseDiffCounts(text: string): { add: number; del: number } | null {
  const m = text.match(/\+(\d+)\s*[−\-]\s*(\d+)/);
  if (!m) return null;
  return { add: Number(m[1]), del: Number(m[2]) };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "The server response could not be read." };
  }
}

export function BuildSessionPanel(props: {
  botId?: string;
  initialGoal?: string;
  /** Optional bearer for API calls when cookie session is absent in tests. */
  authHeader?: string | null;
}) {
  const [goal, setGoal] = useState(props.initialGoal ?? "");
  const [session, setSession] = useState<PublicSession | null>(null);
  const [steer, setSteer] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [clockMs, setClockMs] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const botId = props.botId?.trim() || "build-bot";

  const headers = useMemo(() => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (props.authHeader) h.authorization = props.authHeader;
    return h;
  }, [props.authHeader]);

  const stopStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  useEffect(() => {
    if (!session || session.status === "done" || session.status === "failed" || session.status === "cancelled") {
      setClockMs(session?.elapsedMs ?? 0);
      return;
    }
    const started = Date.parse(session.startedAt);
    const tick = () => setClockMs(Math.max(0, Date.now() - started));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [session]);

  const attachStream = useCallback(
    (id: string, afterSeq = -1) => {
      stopStream();
      const url = `/api/mind/build-session/stream?id=${encodeURIComponent(id)}&afterSeq=${afterSeq}`;
      // EventSource cannot set Authorization; cookie session is the primary path.
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;
      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { session?: PublicSession };
          if (data.session) setSession(data.session);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("event", (ev) => {
        try {
          const evt = JSON.parse((ev as MessageEvent).data) as TimelineEvent;
          setSession((prev) => {
            if (!prev) return prev;
            if (prev.timeline.some((item) => item.seq === evt.seq)) return prev;
            return { ...prev, timeline: [...prev.timeline, evt], lastSeq: Math.max(prev.lastSeq, evt.seq) };
          });
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("status", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            status?: string;
            elapsedMs?: number;
            lastSeq?: number;
            resolved?: PublicSession["resolved"];
          };
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status ?? prev.status,
                  elapsedMs: data.elapsedMs ?? prev.elapsedMs,
                  lastSeq: data.lastSeq ?? prev.lastSeq,
                  resolved: data.resolved ?? prev.resolved,
                }
              : prev,
          );
        } catch {
          /* ignore */
        }
      });
      es.addEventListener("done", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as { session?: PublicSession };
          if (data.session) setSession(data.session);
        } catch {
          /* ignore */
        }
        stopStream();
      });
      es.addEventListener("disconnected", () => {
        setNotice("Stream disconnected. Reconnecting…");
        const last = session?.lastSeq ?? afterSeq;
        window.setTimeout(() => attachStream(id, last), 800);
      });
      es.onerror = () => {
        // Browser will retry EventSource; surface honest notice once.
        setNotice("Build stream interrupted. Waiting to resume…");
      };
    },
    [session?.lastSeq, stopStream],
  );

  async function startBuild() {
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/mind/build-session/start", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ goal, botId, modelTier: "Build" }),
      });
      const body = await readJson(res);
      if (!body.ok || !body.session) {
        setNotice(typeof body.error === "string" ? body.error : "Could not start build.");
        return;
      }
      const next = body.session as PublicSession;
      setSession(next);
      attachStream(next.id, next.lastSeq);
    } catch {
      setNotice("Could not reach the build session API.");
    } finally {
      setBusy(false);
    }
  }

  async function sendSteer() {
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mind/build-session/steer", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ id: session.id, text: steer }),
      });
      const body = await readJson(res);
      if (!body.ok) {
        setNotice(typeof body.error === "string" ? body.error : "Steer failed.");
        return;
      }
      if (body.session) setSession(body.session as PublicSession);
      setSteer("");
    } catch {
      setNotice("Steer request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBuild() {
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mind/build-session/cancel", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ id: session.id }),
      });
      const body = await readJson(res);
      if (body.session) setSession(body.session as PublicSession);
      if (!body.ok) setNotice(typeof body.error === "string" ? body.error : "Cancel failed.");
      stopStream();
    } catch {
      setNotice("Cancel request failed.");
    } finally {
      setBusy(false);
    }
  }

  const running = session && !["done", "failed", "cancelled"].includes(session.status);

  const diffEvents = session?.timeline.filter((evt) => evt.kind === "diff") ?? [];
  const toolLogEvents =
    session?.timeline.filter((evt) => evt.kind === "tool_call" || evt.kind === "log" || evt.kind === "status" || evt.kind === "error" || evt.kind === "reasoning" || evt.kind === "message" || evt.kind === "steer") ?? [];
  const testEvents = session?.timeline.filter((evt) => evt.kind === "test_result") ?? [];
  const summaryEvents = session?.timeline.filter((evt) => evt.kind === "summary") ?? [];

  return (
    <section
      className="bsp-shell rounded-panel border border-line bg-surface p-4"
      data-testid="build-session-panel"
      data-bsp="shell"
      data-bsp-status={session?.status ?? "idle"}
      data-bsp-live={running ? "true" : "false"}
    >
      <header className="bsp-header" data-bsp="header">
        <div className="bsp-header__title">
          <h3 className="font-semibold">Build session</h3>
          <p className="mt-1 text-sm text-muted">
            Live build progress streams from the server. This is not a local simulation.
          </p>
        </div>
        <div
          className="bsp-timer"
          data-bsp="timer"
          data-testid="build-session-timer"
          data-live={running ? "true" : "false"}
          data-empty={session ? "false" : "true"}
          aria-live="polite"
        >
          <span className="bsp-timer__dot" aria-hidden="true" />
          {session ? (
            <span>
              <span className="bsp-timer__status">{session.status}</span>
              <span className="bsp-timer__sep"> · </span>
              Worked for {formatElapsed(clockMs || session.elapsedMs)}
            </span>
          ) : (
            <span>Elapsed — idle</span>
          )}
        </div>
      </header>

      <div className="bsp-start mt-3 flex flex-wrap gap-2" data-bsp="start">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should this bot build?"
          className="bsp-goal min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-bg px-3 text-sm"
          disabled={Boolean(running)}
          aria-label="Build goal"
        />
        <button
          type="button"
          className="bsp-start-btn min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
          disabled={busy || !goal.trim() || Boolean(running)}
          onClick={() => void startBuild()}
        >
          Start build
        </button>
        <button
          type="button"
          className="bsp-cancel-btn min-h-11 rounded-panel border border-line px-3 text-sm"
          disabled={busy || !session || !running}
          onClick={() => void cancelBuild()}
        >
          Cancel
        </button>
      </div>

      {session ? (
        <div className="bsp-body mt-4 space-y-3" data-bsp="body">
          {session.resolved ? (
            <p className="bsp-resolved text-sm text-muted" data-bsp="resolved">
              {session.resolved.provider}/{session.resolved.model}
            </p>
          ) : null}

          <div className="bsp-grid" data-bsp="grid">
            <div className="bsp-panel" data-bsp="steps-panel">
              <p className="bsp-panel__label">Timeline</p>
              {session.plan.length > 0 ? (
                <ol className="bsp-steps" data-bsp="steps" data-testid="build-plan-steps">
                  {session.plan.map((step, index) => (
                    <li
                      key={step.id}
                      className="bsp-step"
                      data-bsp="step"
                      data-status={step.status}
                    >
                      <span className="bsp-step__idx" aria-hidden="true">
                        {index + 1}
                      </span>
                      <div className="bsp-step__body">
                        <strong>{step.title}</strong>
                        <span className="bsp-step__status">[{step.status}]</span>
                        {step.resolved ? (
                          <span className="bsp-step__model">
                            {step.resolved.provider}/{step.resolved.model}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="bsp-empty" data-bsp="steps-empty">
                  No plan steps yet.
                </p>
              )}

              <p className="bsp-panel__label">Tools &amp; logs</p>
              {toolLogEvents.length > 0 ? (
                <ul className="bsp-log" data-bsp="tools-logs" data-testid="build-timeline">
                  {toolLogEvents.map((evt) => (
                    <li
                      key={evt.id}
                      className="bsp-log__row"
                      data-bsp="log-row"
                      data-kind={evt.kind}
                    >
                      <span className="bsp-log__kind">{evt.kind}</span>
                      <span className="bsp-log__text">{evt.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bsp-empty" data-bsp="logs-empty" data-testid="build-timeline">
                  No tool or log rows yet.
                </p>
              )}
            </div>

            <div className="bsp-panel" data-bsp="artifacts-panel">
              <p className="bsp-panel__label">Diffs</p>
              {diffEvents.length > 0 ? (
                <div className="bsp-diffs" data-bsp="diffs" data-testid="build-diffs">
                  {diffEvents.map((evt) => {
                    const counts = parseDiffCounts(evt.text);
                    return (
                      <article key={evt.id} className="bsp-diff" data-bsp="diff-card">
                        <span className="bsp-diff__path">{evt.text}</span>
                        {counts ? (
                          <span className="bsp-diff__counts" aria-label="Diff counts">
                            <span className="bsp-diff__add">+{counts.add}</span>
                            <span className="bsp-diff__del">−{counts.del}</span>
                          </span>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="bsp-empty" data-bsp="diffs-empty">
                  No diffs yet. ± counts render when the session emits diff events.
                </p>
              )}

              <p className="bsp-panel__label">Summary</p>
              {session.summary || summaryEvents.length > 0 ? (
                <div className="bsp-prose" data-bsp="summary" data-testid="build-summary">
                  {session.summary ? <p>{session.summary}</p> : null}
                  {summaryEvents.map((evt) => (
                    <p key={evt.id}>{evt.text}</p>
                  ))}
                </div>
              ) : (
                <p className="bsp-empty" data-bsp="summary-empty">
                  Summary appears when the session finishes one.
                </p>
              )}

              <p className="bsp-panel__label">Test plan</p>
              {testEvents.length > 0 ? (
                <div className="bsp-prose" data-bsp="test-plan" data-testid="build-test-plan">
                  {testEvents.map((evt) => (
                    <p key={evt.id}>{evt.text}</p>
                  ))}
                </div>
              ) : (
                <p className="bsp-empty" data-bsp="test-plan-empty" data-testid="build-test-plan-empty">
                  Test plan slot waits for <code>test_result</code> timeline events from Logic Bot.
                </p>
              )}
            </div>
          </div>

          <div
            className="bsp-steer"
            data-bsp="steer"
            data-testid="build-session-steer"
            data-active={running ? "true" : "false"}
          >
            <p className="bsp-panel__label">Steer</p>
            <p className="bsp-steer__hint">
              Sticky mid-build steer channel. Voice Wiring can POST transcripts to the same session.
            </p>
            {running ? (
              <div className="bsp-steer__row flex flex-wrap gap-2">
                <input
                  value={steer}
                  onChange={(e) => setSteer(e.target.value)}
                  placeholder="Steer mid-build (text or voice transcript)"
                  className="bsp-steer__input min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-bg px-3 text-sm"
                  aria-label="Steer build session"
                />
                <button
                  type="button"
                  className="bsp-steer__btn min-h-11 rounded-panel border border-line px-3 text-sm"
                  disabled={busy || !steer.trim()}
                  onClick={() => void sendSteer()}
                >
                  Steer
                </button>
              </div>
            ) : (
              <div
                className="bsp-steer__idle"
                role="note"
                aria-disabled="true"
                title="Start a build to steer"
              >
                Steer unlocks while a session is live.
              </div>
            )}
          </div>

          {session.error ? (
            <p className="bsp-error text-sm text-muted" data-bsp="error" role="alert">
              {session.error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="bsp-empty mt-4" data-bsp="idle-empty" data-testid="build-session-empty">
          No build session is running. Start one above — nothing is simulated.
        </p>
      )}
      {notice ? (
        <p className="bsp-notice mt-3 text-sm text-muted" data-bsp="notice">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
