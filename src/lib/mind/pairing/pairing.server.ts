import { requireUserId, UnauthorizedError } from "../../auth/verify.server";
import {
  mintPairingCode,
  exchangePairingCode,
  rotateDeviceToken,
  findDeviceByToken,
} from "./handshake.ts";
import { signDeviceAction, verifyAndAuthorizeAction, reportActionOutcome } from "./actions.ts";
import {
  engageDeviceEmergencyStop,
  clearDeviceEmergencyStop,
} from "./emergency-stop.ts";
import { pairingCardState, recordHeartbeat, pcCapabilityFromPairing } from "./status.ts";
import { managementKeyLabel, readManagementKey } from "./management-key.ts";
import type { DeviceActionKind } from "./scope.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bearer(request: Request): string | undefined {
  const h = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1];
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handlePairingStatus(request: Request) {
  try {
    const userId = await requireUserId(bearer(request));
    const card = pairingCardState(userId);
    const capability = pcCapabilityFromPairing(userId);
    return json({ ok: true, card, capability, managementKey: managementKeyLabel() });
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: false, error: "Status failed." }, 500);
  }
}

export async function handleMintPairingCode(request: Request) {
  try {
    const userId = await requireUserId(bearer(request));
    const key = readManagementKey();
    if (!key.ok) return json({ ok: false, error: key.error }, 503);
    const minted = mintPairingCode(userId);
    if (!minted.ok) return json(minted, 400);
    // Return the short-lived code to the signed-in owner only — never the management key.
    return json({ ok: true, code: minted.code, expiresAt: minted.expiresAt, id: minted.id });
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: false, error: "Could not mint pairing code." }, 500);
  }
}

export async function handleHandshake(request: Request) {
  const body = await readJson(request);
  const code = typeof body.code === "string" ? body.code : "";
  const publicKeyPem = typeof body.publicKeyPem === "string" ? body.publicKeyPem : "";
  const deviceName = typeof body.deviceName === "string" ? body.deviceName : "HP EliteBook";
  const result = exchangePairingCode({ code, publicKeyPem, deviceName });
  if (!result.ok) return json(result, 400);
  return json({
    ok: true,
    deviceId: result.deviceId,
    token: result.token,
    tokenId: result.tokenId,
    scopes: result.scopes,
    expiresAt: result.expiresAt,
  });
}

export async function handleHeartbeat(request: Request) {
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : bearer(request) || "";
  const result = recordHeartbeat(token);
  if (!result.ok) return json(result, 401);
  return json({ ok: true, lastHeartbeatAt: result.lastHeartbeatAt });
}

export async function handleSignAction(request: Request) {
  try {
    const userId = await requireUserId(bearer(request));
    const body = await readJson(request);
    const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken : "";
    const found = findDeviceByToken(deviceToken);
    if (!found.ok) return json(found, 401);
    if (found.device.userId !== userId) return json({ ok: false, error: "Device does not belong to you." }, 403);
    const kind = body.kind as DeviceActionKind;
    const signed = signDeviceAction({
      deviceToken,
      kind,
      path: typeof body.path === "string" ? body.path : undefined,
      command: typeof body.command === "string" ? body.command : undefined,
      args: Array.isArray(body.args) ? body.args.filter((a): a is string => typeof a === "string") : [],
      approvalToken: typeof body.approvalToken === "string" ? body.approvalToken : null,
      autonomy: body.autonomy === "automatic" ? "automatic" : "ask",
      allowedRoots: Array.isArray(body.allowedRoots)
        ? body.allowedRoots.filter((a): a is string => typeof a === "string")
        : undefined,
    });
    if (!signed.ok) return json(signed, 400);
    return json({ ok: true, action: signed.action });
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: false, error: "Sign failed." }, 500);
  }
}

export async function handleVerifyAction(request: Request) {
  const body = await readJson(request);
  const deviceToken = typeof body.token === "string" ? body.token : "";
  const action = body.action as Parameters<typeof verifyAndAuthorizeAction>[0]["action"];
  const result = verifyAndAuthorizeAction({
    deviceToken,
    action,
    emergencyStopped: body.emergencyStopped === true,
    autonomy: body.autonomy === "automatic" ? "automatic" : "ask",
    allowedRoots: Array.isArray(body.allowedRoots)
      ? body.allowedRoots.filter((a): a is string => typeof a === "string")
      : undefined,
  });
  if (!result.ok) {
    if (deviceToken && action?.actionId) {
      reportActionOutcome({
        deviceToken,
        actionId: action.actionId,
        kind: action.kind,
        outcome: "rejected",
        detail: result.error,
      });
    }
    return json(result, 400);
  }
  return json({ ok: true });
}

export async function handleReportAction(request: Request) {
  const body = await readJson(request);
  const deviceToken = typeof body.token === "string" ? body.token : "";
  const result = reportActionOutcome({
    deviceToken,
    actionId: typeof body.actionId === "string" ? body.actionId : "",
    kind: typeof body.kind === "string" ? body.kind : "unknown",
    outcome:
      body.outcome === "success" || body.outcome === "failure" || body.outcome === "rejected"
        ? body.outcome
        : "failure",
    detail: typeof body.detail === "string" ? body.detail : "",
  });
  if (!result.ok) return json(result, 401);
  return json({ ok: true, report: result.report });
}

export async function handleEmergencyStop(request: Request) {
  try {
    const body = await readJson(request);
    // Device can self-stop with its token; owner can stop via session.
    const deviceToken = typeof body.token === "string" ? body.token : "";
    if (deviceToken) {
      const found = findDeviceByToken(deviceToken);
      // Even if token already revoked mid-flight, try engage with user from body session
      if (found.ok) {
        const result = engageDeviceEmergencyStop({
          deviceId: found.device.id,
          userId: found.device.userId,
          deviceToken,
        });
        if (!result.ok) return json(result, 400);
        return json({ ok: true, deviceId: result.deviceId, killed: true });
      }
    }
    const userId = await requireUserId(bearer(request));
    const result = engageDeviceEmergencyStop({
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      userId,
    });
    if (!result.ok) return json(result, 400);
    return json({ ok: true, deviceId: result.deviceId, killed: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: false, error: "Stop failed." }, 500);
  }
}

export async function handleClearEmergencyStop(request: Request) {
  try {
    const userId = await requireUserId(bearer(request));
    const body = await readJson(request);
    const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
    if (!deviceId) return json({ ok: false, error: "deviceId is required." }, 400);
    const result = clearDeviceEmergencyStop({ deviceId, userId });
    if (!result.ok) return json(result, 403);
    return json({ ok: true, note: "Stop cleared. Re-pair to obtain a new device token." });
  } catch (err) {
    if (err instanceof UnauthorizedError) return json({ ok: false, error: "Unauthorized" }, 401);
    return json({ ok: false, error: "Clear failed." }, 500);
  }
}

export async function handleRotateToken(request: Request) {
  const body = await readJson(request);
  const token = typeof body.token === "string" ? body.token : "";
  const result = rotateDeviceToken(token);
  if (!result.ok) return json(result, 401);
  return json({ ok: true, token: result.token, tokenId: result.tokenId, expiresAt: result.expiresAt });
}
