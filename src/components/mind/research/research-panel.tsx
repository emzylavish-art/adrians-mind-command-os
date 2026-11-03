import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadResearchDepth,
  saveResearchDepth,
  suggestDeepResearch,
  type ResearchDepthMode,
} from "@/lib/mind/research-mode";
import { planDeepQueries, researchReportToMarkdown, type ResearchCitation, type ResearchReport } from "@/lib/mind/research";
import type { PublicResearchSession, ResearchTimelineEvent } from "@/lib/mind/research-session";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { getBearerToken } from "@/lib/auth/client";

type Props = {
  halted: boolean;
  researchText: string;
  setResearchText: (value: string) => void;
  researchCitations: ResearchCitation[];
  setResearchCitations: (value: ResearchCitation[]) => void;
  researchNote: string | null;
  setResearchNote: (value: string | null) => void;
  onAudit: (ok: boolean, detail: string) => void;
  onFailure: (message: string, retry: () => void) => void;
  onClearFailure: () => void;
  reportEmergencyStop: (area: string, retry: () => void) => void;
  reaSlot?: import("react").ReactNode;
};

export function ResearchPanel(props: Props) {
  const {
    halted,
    researchText,
    setResearchText,
    researchCitations,
    setResearchCitations,
    researchNote,
    setResearchNote,
    onAudit,
    onFailure,
    onClearFailure,
    reportEmergencyStop,
    reaSlot,
  } = props;

  const [depth, setDepth] = useState<ResearchDepthMode>("search");
  const [planOpen, setPlanOpen] = useState(false);
  const [planLines, setPlanLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<{ query: string; ok: boolean; count: number }[]>([]);
  const [partial, setPartial] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [timeline, setTimeline] = useState<ResearchTimelineEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const hint = useMemo(() => suggestDeepResearch(researchText), [researchText]);

  useEffect(() => {
    setDepth(loadResearchDepth(typeof localStorage === "undefined" ? null : localStorage));
  }, []);

  const chooseDepth = (mode: ResearchDepthMode) => {
    setDepth(mode);
    saveResearchDepth(typeof localStorage === "undefined" ? null : localStorage, mode);
    if (mode === "deep") {
      setPlanLines(planDeepQueries(researchText || "research topic"));
      setPlanOpen(true);
    } else {
      setPlanOpen(false);
    }
  };

  const stopStream = () => {
    streamAbort.current?.abort();
    streamAbort.current = null;
  };

  const applyDone = useCallback(
    (session: PublicResearchSession) => {
      setResearchCitations(session.citations);
      setSteps(session.steps ?? []);
      setPartial(Boolean(session.partial));
      setCancelled(Boolean(session.cancelled));
      setReport(session.report ?? null);
      setResearchNote(session.summary || session.error || (session.status === "cancelled" ? "Research was cancelled." : ""));
      onAudit(session.status === "done", session.status);
      if (session.status === "failed") {
        onFailure(session.error || "Research refused. No citations were created.", () => {
          void runSession();
        });
      } else {
        onClearFailure();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAudit, onClearFailure, onFailure, setResearchCitations, setResearchNote],
  );

  async function openStream(id: string) {
    stopStream();
    const controller = new AbortController();
    streamAbort.current = controller;
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
    const token = getBearerToken();
    const response = await fetch(`${prefix}/api/mind/research/stream?id=${encodeURIComponent(id)}&afterSeq=-1`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok || !response.body) {
      throw new Error("Research stream could not be opened.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === "event" && payload && typeof payload === "object") {
          const evt = payload as ResearchTimelineEvent;
          setTimeline((prev) => [...prev, evt].slice(-50));
          if (evt.step && (evt.kind === "step_done" || evt.kind === "step_start")) {
            setSteps((prev) => {
              const next = [...prev];
              if (typeof evt.index === "number") next[evt.index] = evt.step!;
              else next.push(evt.step!);
              return next;
            });
          }
          if (evt.kind === "partial") setPartial(true);
          if (evt.kind === "cancelled") setCancelled(true);
        }
        if (event === "status" && payload && typeof payload === "object") {
          const st = payload as { steps?: typeof steps; partial?: boolean; cancelled?: boolean };
          if (st.steps) setSteps(st.steps);
          if (st.partial) setPartial(true);
          if (st.cancelled) setCancelled(true);
        }
        if (event === "done" && payload && typeof payload === "object") {
          const body = payload as { session?: PublicResearchSession };
          if (body.session) applyDone(body.session);
          setBusy(false);
          setSessionId(null);
          stopStream();
        }
      }
    }
  }

  async function runSession() {
    if (halted) {
      reportEmergencyStop("search", () => void runSession());
      return;
    }
    const query = researchText.trim();
    if (!query) {
      setResearchNote("Write what you want researched.");
      return;
    }
    if (depth === "deep" && planOpen === false) {
      setPlanLines(planDeepQueries(query));
      setPlanOpen(true);
      return;
    }
    setBusy(true);
    setResearchCitations([]);
    setSteps([]);
    setPartial(false);
    setCancelled(false);
    setReport(null);
    setTimeline([]);
    setResearchNote(depth === "deep" ? "Deep research starting…" : "Searching…");
    try {
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const token = getBearerToken();
      const response = await fetch(`${prefix}/api/mind/research/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query,
          deep: depth === "deep",
          plan: depth === "deep" ? planLines : undefined,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string; session?: PublicResearchSession };
      if (!response.ok || !payload.ok || !payload.session) {
        throw new Error(payload.error || "Research could not start.");
      }
      setSessionId(payload.session.id);
      setPlanOpen(false);
      await openStream(payload.session.id);
    } catch (caught) {
      setBusy(false);
      setSessionId(null);
      const message = caught instanceof Error ? caught.message : "The search did not run. No citations were created.";
      setResearchNote(message);
      onFailure(message, () => void runSession());
    }
  }

  async function cancelSession() {
    if (!sessionId) {
      stopStream();
      setBusy(false);
      return;
    }
    try {
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const token = getBearerToken();
      await fetch(`${prefix}/api/mind/research/cancel`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: sessionId }),
      });
      setCancelled(true);
    } catch {
      /* stream done handler will settle */
    }
  }

  function exportMarkdown() {
    if (!report) return;
    const md = researchReportToMarkdown(report);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adrian-mind-research-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page-shell">
      <div className="page-hero card-texture">
        <div className="flex items-center gap-3">
          <img src="/icons/research.svg" alt="" className="size-8" />
          <div>
            <h2 className="font-display text-3xl font-bold">Research</h2>
            <p className="text-sm text-muted">
              Search uses a configured provider (or the built-in search adapter). Deep runs an editable multi-step plan.
              Citations are only http(s) URLs the provider returned, or excerpts marked &quot;from your file&quot;.
            </p>
          </div>
        </div>

        <div className="mt-3 inline-flex rounded-panel border border-line p-1" role="group" aria-label="Research depth">
          <button
            type="button"
            className={`min-h-11 rounded-panel px-4 text-sm font-semibold ${depth === "search" ? "bg-accent text-white" : "text-muted"}`}
            aria-pressed={depth === "search"}
            onClick={() => chooseDepth("search")}
          >
            Search
          </button>
          <button
            type="button"
            className={`min-h-11 rounded-panel px-4 text-sm font-semibold ${depth === "deep" ? "bg-accent text-white" : "text-muted"}`}
            aria-pressed={depth === "deep"}
            onClick={() => chooseDepth("deep")}
          >
            Deep
          </button>
        </div>
        {hint && depth === "search" ? (
          <p className="mt-2 text-xs text-muted">Suggestion: this query looks like a Deep run. The Search|Deep toggle is never overridden automatically.</p>
        ) : null}

        <textarea
          value={researchText}
          onChange={(event) => setResearchText(event.target.value)}
          placeholder="What do you want to research?"
          rows={3}
          className="input-glow mt-3 w-full rounded-panel border border-line bg-bg/70 px-3 py-2 text-sm"
        />

        {depth === "deep" && planOpen ? (
          <div className="mt-3 rounded-panel border border-line bg-bg/50 p-3" data-testid="research-plan">
            <p className="text-sm font-semibold">Editable plan</p>
            <p className="text-xs text-muted">Approve or edit steps, then run. Empty lines are dropped.</p>
            <ul className="mt-2 space-y-2">
              {planLines.map((line, index) => (
                <li key={index} className="flex gap-2">
                  <input
                    className="min-h-11 flex-1 rounded-panel border border-line bg-surface px-3 text-sm"
                    value={line}
                    onChange={(event) => {
                      const next = [...planLines];
                      next[index] = event.target.value;
                      setPlanLines(next);
                    }}
                  />
                  <button
                    type="button"
                    className="min-h-11 rounded-panel border border-line px-3 text-sm"
                    onClick={() => setPlanLines(planLines.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-11 rounded-panel border border-line px-3 text-sm"
                onClick={() => setPlanLines([...planLines, ""].slice(0, 5))}
                disabled={planLines.length >= 5}
              >
                Add step
              </button>
              <button
                type="button"
                className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
                disabled={halted || busy}
                onClick={() => void runSession()}
              >
                Run deep research
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
              disabled={halted || busy}
              aria-busy={busy}
              onClick={() => {
                if (depth === "deep") {
                  setPlanLines(planDeepQueries(researchText || "research topic"));
                  setPlanOpen(true);
                  return;
                }
                void runSession();
              }}
            >
              {busy ? "Running…" : depth === "deep" ? "Plan deep research" : "Check research"}
            </button>
            {busy ? (
              <button type="button" className="min-h-11 rounded-panel border border-line px-4 text-sm font-semibold" onClick={() => void cancelSession()}>
                Cancel
              </button>
            ) : null}
          </div>
        )}

        {partial ? <p className="mt-3 rounded-panel border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">Partial results — some steps timed out; only confirmed sources are listed.</p> : null}
        {cancelled ? <p className="mt-3 rounded-panel border border-line px-3 py-2 text-sm">Cancelled — confirmed sources kept when present.</p> : null}
        {researchNote ? <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{researchNote}</p> : null}

        {steps.length > 0 ? (
          <ol className="mt-3 space-y-1 text-sm" data-testid="research-steps">
            {steps.map((step, index) => (
              <li key={`${index}-${step.query}`} className="dense-row">
                <span className="font-semibold">{step.ok ? "ok" : "miss"}</span>
                <span className="text-muted"> · {step.count} · {step.query}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {timeline.length > 0 ? (
          <ul className="mt-2 max-h-40 overflow-auto text-xs text-muted" data-testid="research-timeline">
            {timeline.map((evt) => (
              <li key={evt.id}>{evt.text}</li>
            ))}
          </ul>
        ) : null}

        {researchCitations.length === 0 && !researchNote ? (
          <div className="empty-state mt-4">
            <img src="/empty/empty-search.svg" alt="" />
            <p className="font-semibold">No citations yet</p>
            <p className="text-sm text-muted">Run a check when a search provider is configured.</p>
          </div>
        ) : null}

        {researchCitations.length > 0 && (
          <ul className="mt-3 space-y-2 text-sm">
            {researchCitations.map((item) => (
              <li key={`${item.url}-${item.title}`} className="dense-row">
                {/^https?:\/\//i.test(item.url) ? (
                  <a className="text-accent underline" href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                ) : (
                  <span>
                    {item.title} — <em>{item.url}</em>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {report ? (
          <div className="mt-4 rounded-panel border border-line p-3" data-testid="research-report">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{report.title}</h3>
              <button type="button" className="min-h-11 rounded-panel border border-line px-3 text-sm" onClick={exportMarkdown}>
                Export .md
              </button>
            </div>
            {report.gaps.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                {report.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : null}
            {report.sections.map((section) => (
              <div key={section.id} className="mt-3">
                <h4 className="text-sm font-semibold">{section.title}</h4>
                <pre className="mt-1 whitespace-pre-wrap text-xs text-muted">{section.body}</pre>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {reaSlot ? <div className="mt-4">{reaSlot}</div> : null}
    </section>
  );
}

