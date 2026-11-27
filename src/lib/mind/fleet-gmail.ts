import { createHash } from "node:crypto";
import type { StoredConnection } from "./connectors/store.ts";
import type { ExternalFleetOutcome, ExternalFleetRequest } from "./fleet-external.ts";

export type FleetAdapterDeps = {
  fetch: typeof fetch;
  connection: (owner: string) => Promise<StoredConnection | null>;
  decrypt: (ciphertext: string) => string | null;
  env: Record<string, string | undefined>;
};

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.length > 500_000) throw new Error("Response exceeds supported size.");
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Unreadable response.");
  return data as Record<string, unknown>;
}

/** Fixed Gmail origin, no redirects, account identity and scope checks before an operation. */
export async function executeFleetGmail(owner: string, request: ExternalFleetRequest, deps: FleetAdapterDeps): Promise<ExternalFleetOutcome> {
  const account = request.accountId ?? request.input?.accountId;
  const connection = await deps.connection(owner);
  if (!connection || connection.ownerId !== owner || connection.connector !== "gmail") return { ok: false, error: "Connect the selected Gmail account before running this step.", outcome: "not_sent" };
  if (!account || connection.accountLabel?.toLowerCase() !== account.toLowerCase() || !request.input?.connectionVersion || request.input.connectionVersion !== connection.connectedAt) return { ok: false, error: "The selected Gmail account or its grant changed. Review the current account and create a fresh authorization.", outcome: "not_sent" };
  const scopes = new Set((connection.scopes ?? "").split(/\s+/));
  const scope = request.action === "gmail_send" ? "https://www.googleapis.com/auth/gmail.send" : "https://www.googleapis.com/auth/gmail.readonly";
  if (!scopes.has(scope) && !scopes.has("https://mail.google.com/") && !scopes.has("https://www.googleapis.com/auth/gmail.modify")) return { ok: false, error: "The Gmail grant is missing this operation's permission. Reconnect with the required scope, then review again.", outcome: "not_sent" };
  const token = deps.decrypt(connection.accessTokenEnc);
  if (!token) return { ok: false, error: "The Gmail credential cannot be read. Reconnect this account.", outcome: "not_sent" };
  const headers = { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" };
  const get = (path: string) => deps.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  try {
    const profileResponse = await get("profile");
    if (!profileResponse.ok) return { ok: false, error: "Gmail could not verify this account. Check its connection and permissions; nothing was sent.", outcome: "not_sent" };
    const profile = await boundedJson(profileResponse);
    if (typeof profile.emailAddress !== "string" || profile.emailAddress.toLowerCase() !== account.toLowerCase()) return { ok: false, error: "Gmail returned a different account. Nothing was read or sent.", outcome: "not_sent" };
  } catch { return { ok: false, error: "Gmail account verification was unavailable. No operation was dispatched.", outcome: "not_sent" }; }
  if (request.action === "gmail_read") {
    try {
      const response = await get(`messages?maxResults=10&q=${encodeURIComponent(request.goal)}`);
      if (!response.ok) return { ok: false, error: `Gmail rejected the read (HTTP ${response.status}). Check this account's permissions.`, outcome: "rejected" };
      const listing = await boundedJson(response);
      const rows = Array.isArray(listing.messages) ? listing.messages.slice(0, 10) : [];
      const excerpts: string[] = [];
      for (const item of rows) {
        const id = item && typeof item === "object" && "id" in item && typeof item.id === "string" ? item.id : "";
        if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) continue;
        const detail = await get(`messages/${encodeURIComponent(id)}?format=full`);
        if (!detail.ok) return { ok: false, error: "Gmail message access changed during retrieval. The read was incomplete; no complete mailbox result was reported.", outcome: "rejected" };
        const message = await boundedJson(detail);
        excerpts.push(`${id}: ${typeof message.snippet === "string" ? message.snippet.slice(0, 2000) : "No text preview returned."}`);
      }
      return { ok: true, accountId: account, operationId: `gmail-read:${request.runId}:${request.stepId}`, text: excerpts.length ? `Gmail ${account}: ${excerpts.length} message previews for ${JSON.stringify(request.goal)}. These are excerpts, not complete messages.\n${excerpts.join("\n")}${listing.nextPageToken ? "\nMore results are available; this read was limited to ten messages." : ""}` : `Gmail ${account}: no matching messages for ${JSON.stringify(request.goal)}.` };
    } catch { return { ok: false, error: "The Gmail read did not finish. No complete result was recorded.", outcome: "unknown" }; }
  }
  const recipients = request.input?.recipients ?? [];
  const subject = request.input?.subject ?? "";
  const body = request.input?.body ?? "";
  if (!recipients.length || recipients.length > 50 || recipients.some(email => !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)) || /[\r\n]/.test(subject) || !body.trim() || body.length > 8000 || subject.length > 1000) return { ok: false, error: "The reviewed Gmail recipients, subject or message are invalid. Nothing was sent.", outcome: "not_sent" };
  const messageId = createHash("sha256").update(`${owner}:${request.runId}:${request.stepId}`).digest("hex");
  const mime = [`From: ${account}`, `To: ${recipients.join(", ")}`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`, `Message-ID: <${messageId}@adrians-mind.invalid>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body).toString("base64")].join("\r\n");
  try {
    const response = await deps.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(25_000), body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }) });
    if (!response.ok) return { ok: false, error: response.status >= 500 ? "Gmail returned a server error after send. The outcome is unknown; check Sent before any replacement." : `Gmail rejected the send (HTTP ${response.status}). Nothing was reported as sent.`, outcome: response.status >= 500 ? "unknown" : "rejected" };
    const receipt = await boundedJson(response);
    if (typeof receipt.id !== "string" || !receipt.id) return { ok: false, error: "Gmail did not return a message ID. The send outcome is unknown; check Sent before any replacement.", outcome: "unknown" };
    return { ok: true, accountId: account, operationId: receipt.id, text: `Gmail accepted message ${receipt.id} from ${account} to ${recipients.join(", ")}. This confirms provider acceptance, not recipient delivery.` };
  } catch { return { ok: false, error: "The Gmail send lost its response. Its outcome is unknown; check Sent before any replacement. This operation will not be replayed automatically.", outcome: "unknown" }; }
}
