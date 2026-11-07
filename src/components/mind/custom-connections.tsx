import { useEffect, useRef, useState } from "react";
import { callCustomConnectionFn, listCustomConnectionsFn, saveCustomConnectionFn } from "@/lib/mind/custom-connection-fns";
import type { PublicConnection } from "@/lib/mind/custom-connection";
import { missingConfigNotice, reasonCode, safeReason } from "@/lib/mind/mcp/call-contract";
import { acceptResult, dismissResult, type AttemptView } from "@/components/mind/custom-connection-result";

/** Tools-panel registration for remote MCP and explicit HTTP read/status calls. */
export function CustomConnections({ halted }: { halted: boolean }) {
  const [rows, setRows] = useState<PublicConnection[]>([]);
  const [notice, setNotice] = useState("");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"mcp" | "http">("mcp");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [auth, setAuth] = useState<"none" | "bearer">("none");
  const [token, setToken] = useState("");
  const [fields, setFields] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<AttemptView | null>(null);
  const activeAttempt = useRef("");

  async function reload() {
    const listed = await listCustomConnectionsFn();
    setRows(listed.connections);
  }

  useEffect(() => {
    void reload().catch(() => setNotice("Saved connections could not be loaded."));
  }, []);

  return (
    <div className="mt-6 space-y-3">
      <h3 className="font-semibold">Custom connections</h3>
      <p className="text-sm text-muted">Remote MCP is JSON-RPC POST. Custom HTTP is GET or POST to one https URL, or http on localhost. Bearer tokens stay on the server. A tool without an object argument schema is incompatible and is not called with a generic text argument. model.generate is refused. Gmail is not connected here.</p>
      <form
        className="rounded-panel border border-line bg-surface p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (halted || !url.trim()) return;
          void saveCustomConnectionFn({
            data: {
              label,
              kind,
              url,
              method,
              auth,
              token,
              fields: fields.split(",").map((field) => field.trim()).filter(Boolean),
            },
          }).then((saved) => {
            setToken("");
            if (!saved.ok) {
              const setup = missingConfigNotice({ text: saved.error });
              setNotice(setup ? setup.copy : safeReason(reasonCode("error"), saved.error));
              return;
            }
            setNotice(`${saved.connection.label} saved. State: ${saved.connection.state}.`);
            setLabel("");
            setUrl("");
            setFields("");
            return reload();
          }).catch(() => setNotice("The connection was not saved."));
        }}
      >
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label" className="min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
        <select value={kind} onChange={(event) => setKind(event.target.value === "http" ? "http" : "mcp")} className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm">
          <option value="mcp">Remote MCP</option>
          <option value="http">Custom HTTP</option>
        </select>
        {kind === "http" ? (
          <select value={method} onChange={(event) => setMethod(event.target.value === "POST" ? "POST" : "GET")} className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm">
            <option value="GET">GET read</option>
            <option value="POST">POST (requires confirm)</option>
          </select>
        ) : null}
        <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" />
        <select value={auth} onChange={(event) => setAuth(event.target.value === "bearer" ? "bearer" : "none")} className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm">
          <option value="none">No auth</option>
          <option value="bearer">Bearer token on the server</option>
        </select>
        {auth === "bearer" ? <input value={token} onChange={(event) => setToken(event.target.value)} type="password" autoComplete="off" placeholder="Token" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" /> : null}
        {kind === "http" ? <input value={fields} onChange={(event) => setFields(event.target.value)} placeholder="Argument names, comma separated" className="mt-2 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm" /> : null}
        <button type="submit" className="mt-3 min-h-11 rounded-panel bg-accent px-4 text-sm font-semibold text-accent-ink" disabled={halted || !url.trim()}>Save connection</button>
      </form>
      {notice ? <p className="text-sm text-muted">{notice}</p> : null}
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="rounded-panel border border-line bg-surface p-3">
            <p className="font-semibold">{row.label}</p>
            <p className="text-xs text-muted">{row.kind} · {row.method} · {row.auth} · token {row.hasToken ? "stored" : "none"} · {row.host} · {row.state}</p>
            {row.error ? <p className="text-muted">{row.error}</p> : null}
            {row.operations.map((operation) => (
              <div key={operation.name} className="mt-2">
                <p className="font-semibold">{operation.name} · {operation.compatible ? "schema" : "incompatible"}</p>
                <p className="text-xs text-muted">{operation.description}</p>
                {operation.inputSchema ? Object.entries(operation.inputSchema.properties).map(([name, spec]) => (
                  <label key={name} className="mt-1 block text-xs text-muted">
                    {name} ({spec.type}{operation.inputSchema?.required.includes(name) ? ", required" : ""})
                    <input
                      value={args[`${row.id}:${operation.name}:${name}`] ?? ""}
                      onChange={(event) => setArgs((current) => ({ ...current, [`${row.id}:${operation.name}:${name}`]: event.target.value }))}
                      className="mt-1 min-h-11 w-full rounded-panel border border-line bg-bg px-3 text-sm"
                    />
                  </label>
                )) : <p className="text-xs text-muted">No compatible argument schema. Nothing will be called.</p>}
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
                  Confirm this call
                </label>
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-panel border border-line px-3"
                  disabled={!operation.compatible || halted || ((row.kind === "mcp" || row.method === "POST") && !confirm)}
                  onClick={() => {
                    const payload: Record<string, string | boolean | number> = {};
                    for (const [name, spec] of Object.entries(operation.inputSchema?.properties ?? {})) {
                      const raw = args[`${row.id}:${operation.name}:${name}`] ?? "";
                      if (!raw) continue;
                      payload[name] = spec.type === "integer" ? Number(raw) : spec.type === "boolean" ? raw === "true" : raw;
                    }
                    const localAttemptId = crypto.randomUUID();
                    activeAttempt.current = localAttemptId;
                    setResult({ localAttemptId, upstreamRequestId: null, status: "running", text: "", retryable: false });
                    void callCustomConnectionFn({ data: { id: row.id, operation: operation.name, args: payload, confirmed: confirm || row.method === "GET" } }).then((called) => {
                      const next = acceptResult(activeAttempt.current, { localAttemptId, status: called.status, text: called.text });
                      if (next !== "stale") setResult(next);
                      if (called.connection) setRows((current) => current.map((item) => item.id === called.connection?.id ? called.connection : item));
                    }).catch(() => {
                      const next = acceptResult(activeAttempt.current, { localAttemptId, status: "error", text: "The call did not complete." });
                      if (next !== "stale") setResult(next);
                    });
                  }}
                >
                  Call {operation.name}
                </button>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {result ? (
        <p className="whitespace-pre-wrap text-sm text-muted">
          Result ({result.status}): {result.text}
          <button type="button" className="ml-3 min-h-11 rounded-panel border border-line px-3" onClick={() => setResult(dismissResult())}>Dismiss</button>
        </p>
      ) : null}
    </div>
  );
}
