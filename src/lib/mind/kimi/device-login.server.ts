/** Official Kimi Code device login. Same client and host as `kimi login`.
 * No password field. Tokens are encrypted and never returned to the browser.
 */
import { randomBytes } from "node:crypto";
import { getSql } from "../../db.ts";
import { decryptSecret, encryptSecret } from "../connectors/crypto.ts";

const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const OAUTH_HOST = "https://auth.kimi.ai";
const CONNECTOR = "kimi";
const USER_AGENT = "kimi-code-cli/2.5.3";

export type DeviceStart = {
  ok: true;
  verificationUri: string;
  verificationUriComplete: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

type TokenResponse = Record<string, unknown>;

async function postForm(path: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<{ status: number; data: TokenResponse }> {
  const response = await fetchImpl(`${OAUTH_HOST}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  return { status: response.status, data };
}

function publicStart(data: TokenResponse): DeviceStart | { ok: false; error: string } {
  const userCode = data.user_code;
  const deviceCode = data.device_code;
  const complete = data.verification_uri_complete;
  const uri = data.verification_uri;
  if (typeof userCode !== "string" || typeof deviceCode !== "string" || typeof complete !== "string" || !complete.startsWith("https://")) {
    return { ok: false, error: "Kimi did not return a device login link. Nothing was connected." };
  }
  return {
    ok: true,
    verificationUri: typeof uri === "string" ? uri : "https://www.kimi.ai/code/authorize_device",
    verificationUriComplete: complete,
    userCode,
    expiresIn: Number(data.expires_in ?? 1800),
    interval: Number(data.interval ?? 5),
  };
}

export async function startKimiDeviceLogin(ownerId: string, fetchImpl: typeof fetch = fetch): Promise<DeviceStart | { ok: false; error: string }> {
  if (!ownerId) return { ok: false, error: "Sign in is required." };
  const { status, data } = await postForm("/api/oauth/device_authorization", { client_id: CLIENT_ID }, fetchImpl);
  if (status !== 200) return { ok: false, error: "Kimi device login did not start. Nothing was connected." };
  const started = publicStart(data);
  if (!started.ok) return started;
  const deviceCode = data.device_code;
  if (typeof deviceCode !== "string") return { ok: false, error: "Kimi did not return a device login link. Nothing was connected." };
  const sql = await getSql();
  const state = randomBytes(24).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + Math.min(started.expiresIn, 1500) * 1000);
  await sql.query("DELETE FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2", [ownerId, CONNECTOR]);
  await sql.query(
    "INSERT INTO mind_oauth_pending (state_hash, owner_id, connector, code_verifier_enc, redirect_uri, scopes, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [state, ownerId, CONNECTOR, encryptSecret(deviceCode).ciphertext, started.verificationUri, started.userCode, now.toISOString(), expires.toISOString()],
  );
  return started;
}

export async function pollKimiDeviceLogin(ownerId: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; state: "pending" | "connected"; accountLabel?: string } | { ok: false; error: string }> {
  if (!ownerId) return { ok: false, error: "Sign in is required." };
  const sql = await getSql();
  const pending = await sql.query<{ code_verifier_enc: string; expires_at: string | Date }>(
    "SELECT code_verifier_enc, expires_at FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2 ORDER BY created_at DESC LIMIT 1",
    [ownerId, CONNECTOR],
  );
  const row = pending[0];
  if (!row) {
    const existing = await sql.query<{ account_label: string | null }>(
      "SELECT account_label FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2",
      [ownerId, CONNECTOR],
    );
    if (existing[0]) return { ok: true, state: "connected", accountLabel: existing[0].account_label ?? "Kimi Code" };
    return { ok: false, error: "No Kimi login is waiting. Press Connect Kimi Code first." };
  }
  if (Date.now() > new Date(row.expires_at).getTime()) {
    await sql.query("DELETE FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2", [ownerId, CONNECTOR]);
    return { ok: false, error: "That Kimi login expired. Press Connect Kimi Code again." };
  }
  const deviceCode = decryptSecret(row.code_verifier_enc);
  if (!deviceCode) return { ok: false, error: "The saved Kimi login could not be read. Press Connect Kimi Code again." };
  const { status, data } = await postForm("/api/oauth/token", {
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  }, fetchImpl);
  const errorCode = typeof data.error === "string" ? data.error : "";
  if (errorCode === "authorization_pending" || errorCode === "slow_down") return { ok: true, state: "pending" };
  if (status !== 200 || typeof data.access_token !== "string") {
    if (errorCode === "access_denied" || errorCode === "expired_token") {
      await sql.query("DELETE FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2", [ownerId, CONNECTOR]);
    }
    return { ok: false, error: errorCode === "access_denied" ? "Kimi login was denied. Nothing was stored." : "Kimi has not approved this login yet." };
  }
  const access = encryptSecret(data.access_token).ciphertext;
  const refresh = typeof data.refresh_token === "string" ? encryptSecret(data.refresh_token).ciphertext : null;
  const label = "Kimi Code";
  await sql.query(
    "INSERT INTO mind_oauth_connections (owner_id, connector, access_token_enc, refresh_token_enc, account_label, connected_at, token_type, scopes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (owner_id, connector) DO UPDATE SET access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc, account_label = excluded.account_label, connected_at = excluded.connected_at, token_type = excluded.token_type",
    [ownerId, CONNECTOR, access, refresh, label, new Date().toISOString(), typeof data.token_type === "string" ? data.token_type : "Bearer", typeof data.scope === "string" ? data.scope : null],
  );
  await sql.query("DELETE FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2", [ownerId, CONNECTOR]);
  return { ok: true, state: "connected", accountLabel: label };
}

export async function kimiDeviceStatus(ownerId: string): Promise<{ state: "connected" | "pending" | "not_connected"; detail: string }> {
  const sql = await getSql();
  const existing = await sql.query<{ account_label: string | null }>(
    "SELECT account_label FROM mind_oauth_connections WHERE owner_id = $1 AND connector = $2",
    [ownerId, CONNECTOR],
  );
  if (existing[0]) return { state: "connected", detail: existing[0].account_label ?? "Kimi Code is connected. The token stays on the server." };
  const pending = await sql.query("SELECT 1 FROM mind_oauth_pending WHERE owner_id = $1 AND connector = $2 AND expires_at > now()", [ownerId, CONNECTOR]);
  if (pending.length) return { state: "pending", detail: "Waiting for you to approve the Kimi device login." };
  return { state: "not_connected", detail: "Not connected. Connect uses Kimi's own device login. No password is typed here." };
}
