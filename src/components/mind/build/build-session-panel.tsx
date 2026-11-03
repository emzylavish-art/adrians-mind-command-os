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

  return (
    <section className="rounded-panel border border-line bg-surface p-4" data-testid="build-session-panel">
      <h3 className="font-semibold">Build session</h3>
      <p className="mt-1 text-sm text-muted">
        Live build progress streams from the server. This is not a local simulation.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="What should this bot build?"
          className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-bg px-3 text-sm"
          disabled={Boolean(running)}
        />
        <button
          type="button"
          className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink"
          disabled={busy || !goal.trim() || Boolean(running)}
          onClick={() => void startBuild()}
        >
          Start build
        </button>
        <button
          type="button"
          className="min-h-11 rounded-panel border border-line px-3 text-sm"
          disabled={busy || !session || !running}
          onClick={() => void cancelBuild()}
        >
          Cancel
        </button>
      </div>
      {session ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            <span className="font-semibold">{session.status}</span>
            <span className="text-muted"> · worked for {formatElapsed(clockMs || session.elapsedMs)}</span>
            {session.resolved ? (
              <span className="text-muted">
                {" "}
                · {session.resolved.provider}/{session.resolved.model}
              </span>
            ) : null}
          </p>
          <ol className="space-y-1 text-sm">
            {session.plan.map((step) => (
              <li key={step.id}>
                [{step.status}] {step.title}
              </li>
            ))}
          </ol>
          <div className="max-h-64 overflow-auto rounded-panel border border-line bg-bg p-3 text-xs" data-testid="build-timeline">
            {session.timeline.map((evt) => (
              <p key={evt.id} className="mb-1">
                <span className="text-muted">{evt.kind}</span> {evt.text}
              </p>
            ))}
          </div>
          {running ? (
            <div className="flex flex-wrap gap-2">
              <input
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                placeholder="Steer mid-build (text or voice transcript)"
                className="min-h-11 min-w-0 flex-1 rounded-panel border border-line bg-bg px-3 text-sm"
              />
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm"
                disabled={busy || !steer.trim()}
                onClick={() => void sendSteer()}
              >
                Steer
              </button>
            </div>
          ) : null}
          {session.summary ? (
            <p className="text-sm" data-testid="build-summary">
              <span className="font-semibold">Summary:</span> {session.summary}
            </p>
          ) : null}
          {session.error ? <p className="text-sm text-muted">{session.error}</p> : null}
        </div>
      ) : null}
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}
    </section>
  );
}
