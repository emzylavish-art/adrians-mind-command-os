/**
 * Minimal HTTP client for Logic Bot BuildSession steer/get.
 * Spec: /workspace/audit/logic/BUILD_SESSION_API.md
 * Do not import Logic Bot lane modules — call by path only.
 */

import { isBuildSessionSteerableStatus } from "./active-build-session.ts";

export const BUILD_STEER_PATH = "/api/mind/build-session/steer";
export const BUILD_GET_PATH = "/api/mind/build-session/get";
export const MAX_BUILD_STEER_CHARS = 4000;

export const BUILD_STEER_LABEL = "Steering build";

export type BuildSteerPublicSession = {
  id: string;
  status: string;
  pendingSteerCount?: number;
};

export type BuildSteerResult =
  | { ok: true; session: BuildSteerPublicSession; steered: true }
  | { ok: false; error: string; httpStatus: number; clearActive?: boolean };

export function sanitizeSteerText(value: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof value !== "string") return { ok: false, error: "Steer message must be text." };
  const text = value.trim().slice(0, MAX_BUILD_STEER_CHARS);
  if (!text) return { ok: false, error: "Steer message is empty." };
  return { ok: true, text };
}

export function formatBuildSteerHttpError(status: number, bodyError?: string): string {
  if (bodyError && bodyError.trim()) return bodyError.trim();
  if (status === 401) return "Sign in is required to steer a build.";
  if (status === 403) return "Could not steer the build (forbidden).";
  if (status === 404) return "That build session was not found. Voice will use Direct/Orchestrator instead.";
  if (status === 409) return "This build is already finished. Steer was not applied.";
  if (status === 429) return "Too many steer messages. Wait a minute and try again.";
  if (status >= 500) return `Build steer failed (server ${status}). Try again in a moment.`;
  if (status >= 400) return `Build steer failed (HTTP ${status}).`;
  return "Build steer failed.";
}

export async function fetchBuildSession(
  id: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<BuildSteerResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${BUILD_GET_PATH}?id=${encodeURIComponent(id)}`, {
      method: "GET",
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch {
    return { ok: false, error: "Could not reach the build session service.", httpStatus: 0 };
  }
  let payload: { ok?: boolean; error?: string; session?: BuildSteerPublicSession } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  if (!response.ok || !payload.ok || !payload.session) {
    const clearActive = response.status === 404;
    return {
      ok: false,
      error: formatBuildSteerHttpError(response.status, payload.error),
      httpStatus: response.status,
      clearActive,
    };
  }
  return { ok: true, session: payload.session, steered: true };
}

/** POST finalized voice transcript into the active BuildSession. */
export async function postBuildSteer(
  input: { id: string; text: string },
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<BuildSteerResult> {
  const cleaned = sanitizeSteerText(input.text);
  if (!cleaned.ok) return { ok: false, error: cleaned.error, httpStatus: 400 };
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(BUILD_STEER_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({ id: input.id, text: cleaned.text }),
    });
  } catch {
    return { ok: false, error: "Could not reach the build session service.", httpStatus: 0 };
  }
  let payload: { ok?: boolean; error?: string; session?: BuildSteerPublicSession } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }
  if (!response.ok || !payload.ok || !payload.session) {
    const clearActive = response.status === 404 || response.status === 409;
    return {
      ok: false,
      error: formatBuildSteerHttpError(response.status, payload.error),
      httpStatus: response.status,
      clearActive,
    };
  }
  return { ok: true, session: payload.session, steered: true };
}

/**
 * If `id` is still steerable, POST the transcript. Otherwise signal clearActive
 * so the caller falls back to Direct/Orchestrator.
 */
export async function steerActiveBuildOrFallback(
  input: { id: string; text: string },
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; skipGet?: boolean } = {},
): Promise<BuildSteerResult | { ok: false; error: string; httpStatus: number; clearActive: true; fallback: true }> {
  if (!opts.skipGet) {
    const snap = await fetchBuildSession(input.id, opts);
    if (!snap.ok) {
      return { ...snap, clearActive: Boolean(snap.clearActive), fallback: true as const };
    }
    if (!isBuildSessionSteerableStatus(snap.session.status)) {
      return {
        ok: false,
        error: "This build is already finished. Steer was not applied.",
        httpStatus: 409,
        clearActive: true,
        fallback: true,
      };
    }
  }
  return postBuildSteer(input, opts);
}
