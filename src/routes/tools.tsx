import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { LoadedRegistryTool } from "@/lib/mind/tools-registry/load-registry";

type ToolsPayload = {
  ok?: boolean;
  sourceOfTruth?: string;
  builtins?: LoadedRegistryTool[];
  registry?: LoadedRegistryTool[];
  hardExcluded?: string[];
  error?: string;
};

export const Route = createFileRoute("/tools")({ component: ToolsPage });

function ToolsPage() {
  const [data, setData] = useState<ToolsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mind/tools/registry", { credentials: "same-origin" });
        const body = (await res.json()) as ToolsPayload;
        if (!res.ok || body.ok === false) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load tools registry.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-bg p-6 text-fg">
      <a
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm"
      >
        ← Home
      </a>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Tool Registry</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Callable MCP tools are owned by <code className="text-fg">src/lib/mind/mcp/tool-catalog.ts</code>.
        GitHub inventory is loaded from <code className="text-fg">tools/registry.json</code> with BlackEye /
        L1B3RT4S hard-excluded. GitHub-sourced tools (including GodEye) stay unverified and not callable until a
        verification record exists under <code className="text-fg">tools/verifications/</code>.
      </p>

      {error ? (
        <p className="mt-6 rounded-panel border border-danger/40 bg-danger/10 p-4 text-sm">{error}</p>
      ) : null}
      {!data && !error ? <p className="mt-6 text-sm text-muted">Loading registry…</p> : null}

      {data ? (
        <div className="mt-8 space-y-10">
          <section>
            <h2 className="text-lg font-medium">MCP builtins (source of truth)</h2>
            <p className="mt-1 text-xs text-muted">{data.sourceOfTruth}</p>
            <ul className="mt-4 divide-y divide-line rounded-panel border border-line">
              {(data.builtins || []).map((t) => (
                <li key={t.name} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted">callable · {String(t.status)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-medium">GitHub / inventory registry</h2>
            <p className="mt-1 text-xs text-muted">
              Hard-excluded at load: {(data.hardExcluded || []).join(", ") || "(none)"}
            </p>
            <ul className="mt-4 divide-y divide-line rounded-panel border border-line">
              {(data.registry || []).map((t) => (
                <li key={t.name} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted">
                      {t.callable ? "callable" : t.reasonNotCallable || "not callable"} · {String(t.status)}
                    </span>
                  </div>
                  {t.source_url ? (
                    <a className="mt-1 inline-block text-xs text-accent underline" href={String(t.source_url)} target="_blank" rel="noreferrer">
                      {String(t.source_url)}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </main>
  );
}
