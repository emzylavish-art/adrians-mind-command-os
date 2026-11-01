/**
 * Honest UI failure states already defined in this app.
 * Messages match server/client copy in turn.server, server.ts, policy, fleet, and live-turn.
 * Banner 5 (mcp_tool_failed) matches the MCP integration copy in mcp.ts / mcp/registry.ts / mcp/tools.ts
 * (status "error", ok false, "Nothing was called." / "Nothing was invented.").
 * Top-5 gap kinds reuse CHAT_TIMEOUT_REPLY / CHAT_DISCONNECT_REPLY, auth, and provider-call copy.
 * Banner 4 (image_generation_failed) mirrors media-lane mapImagineHttpError copy (harden.ts);
 * media keeps request/HTTP mapping — this module only classifies and banners that copy.
 */

export type HonestFailureKind =
  | "model_unavailable"
  | "database_write_failed"
  | "emergency_stop_active"
  | "mcp_tool_failed"
  | "chat_timeout"
  | "network_failure"
  | "auth_required"
  | "forbidden_cross_site"
  | "rate_limited"
  | "image_generation_failed";

/** Logic-wiring turn-timeouts copy (CHAT_TIMEOUT_REPLY) — recognized even when that module is not on this branch. */
export const CHAT_TIMEOUT_REPLY = "Timed out waiting for Grok. Nothing was saved as a success.";
/** Logic-wiring disconnect copy (CHAT_DISCONNECT_REPLY). */
export const CHAT_DISCONNECT_REPLY = "Connection to the model dropped";

export const HONEST_FAILURE_MESSAGES = {
  model_unavailable: "That model is not available. Another provider is not substituted.",
  model_unreachable: "Grok could not be reached.",
  model_unconfigured: "Grok is not configured on the server.",
  database_write_failed: "The server copy could not be saved. The browser copy was kept.",
  emergency_stop_active: "Emergency stop is on. No new action can run.",
  mcp_tool_failed: "The MCP tool call failed. Nothing was invented.",
  mcp_unreachable: "The MCP server could not be reached. Nothing was called.",
  chat_timeout: CHAT_TIMEOUT_REPLY,
  /** Stale timeout marker still emitted on this branch's live-turn/relay before logic-wiring merges. */
  chat_timeout_stale: "Grok did not answer in time. Nothing was saved as a success.",
  network_failure: "The network request failed. Nothing was substituted.",
  network_offline: "You are offline. Nothing was reached.",
  auth_required: "Sign in is required.",
  forbidden_cross_site: "Forbidden: cross-site request blocked",
  rate_limited: "The provider rate limited the request. Nothing was substituted.",
  mcp_list_failed: "The MCP server list could not be loaded.",
  mcp_tools_list_failed: "The MCP tools list could not be loaded.",
  pc_approvals_list_failed: "The PC shell approvals list could not be loaded.",
  /** Scheduled panel: workerHealth() rejected / timed out / non-JSON — not the same as honest offline. */
  worker_health_failed: "The worker status could not be read.",
  pc_approve_failed: "The PC shell approval could not be completed.",
  pc_deny_failed: "The PC shell denial could not be completed.",
  /** Default one-line Imagine failure (mapImagineHttpError 5xx). */
  image_generation_failed: "The image service failed. Nothing was saved as a success.",
  image_generation_refused: "Image generation was refused (auth or permission).",
  image_generation_rate_limited: "Image generation is rate-limited right now. Wait a minute and try again.",
  image_generation_moderation: "The image request was refused by content moderation. Try a different prompt.",
  image_generation_invalid: "That Imagine request was invalid. Check the prompt and images.",
  image_generation_too_large: "That Imagine request was too large.",
  image_generation_timeout: "Image generation timed out. Nothing was saved as a success.",
} as const;

export const HONEST_FAILURE_ACTIONS: Record<HonestFailureKind, string> = {
  model_unavailable: "model_unavailable",
  database_write_failed: "database_write_failed",
  emergency_stop_active: "emergency_stop_active",
  mcp_tool_failed: "mcp_tool_failed",
  chat_timeout: "chat_timeout",
  network_failure: "network_failure",
  auth_required: "auth_required",
  forbidden_cross_site: "forbidden_cross_site",
  rate_limited: "rate_limited",
  image_generation_failed: "image_generation_failed",
};

/** Copy the MCP integration code returns when a tool call fails (status "error"). */
const MCP_TOOL_FAILURE_MARKERS = [
  "The MCP server could not be reached",
  "The MCP server returned",
  "The MCP server did not return a JSON-RPC result",
  "The MCP server returned no text",
  "MCP returned nothing",
  "That MCP server is not registered",
  "No MCP server is saved",
  "Unknown built-in tool",
  "Stdio MCP command servers are registered but not executed",
  "No paired PC online",
  "PGLite query error:",
  "MCP tool failed",
  "The MCP tool call failed",
];

const MCP_TOOL_FAILURE_PATTERNS = [/^MCP server “.+” is disabled\./, /^MCP tool “.+” failed\./];

const MODEL_UNAVAILABLE_MARKERS = [
  HONEST_FAILURE_MESSAGES.model_unavailable,
  HONEST_FAILURE_MESSAGES.model_unreachable,
  HONEST_FAILURE_MESSAGES.model_unconfigured,
  "No Grok key is configured",
  "Another provider is not substituted",
  "Grok returned an empty reply",
  "That provider is not known",
];

const CHAT_TIMEOUT_MARKERS = [
  CHAT_TIMEOUT_REPLY,
  HONEST_FAILURE_MESSAGES.chat_timeout_stale,
  "Timed out waiting for Grok",
  "Grok did not answer in time",
];

const NETWORK_FAILURE_MARKERS = [
  HONEST_FAILURE_MESSAGES.network_failure,
  HONEST_FAILURE_MESSAGES.network_offline,
  CHAT_DISCONNECT_REPLY,
  "Failed to fetch",
  "NetworkError",
  "Load failed",
  "fetch failed",
  "You are offline",
  "network request failed",
];


/** Honest Imagine / Edit Imagine copy from media mapImagineHttpError (+ call-site fallbacks). */
const IMAGE_GENERATION_FAILURE_MARKERS = [
  HONEST_FAILURE_MESSAGES.image_generation_failed,
  HONEST_FAILURE_MESSAGES.image_generation_refused,
  HONEST_FAILURE_MESSAGES.image_generation_rate_limited,
  HONEST_FAILURE_MESSAGES.image_generation_moderation,
  HONEST_FAILURE_MESSAGES.image_generation_invalid,
  HONEST_FAILURE_MESSAGES.image_generation_too_large,
  HONEST_FAILURE_MESSAGES.image_generation_timeout,
  "Image generation failed",
  "Image generation returned",
  "Image editing failed",
  "Image editing returned",
  "Imagine failed",
  "Edit with Imagine failed",
  "Imagine could not be reached",
  "Edit with Imagine could not be reached",
  "Could not reach the xAI image generation endpoint",
  "Could not reach the xAI image edits endpoint",
  "No xAI inference API key is available for image",
];

export function classifyHonestFailure(message: string): HonestFailureKind | null {
  const text = message.trim();
  if (!text) return null;
  if (text === HONEST_FAILURE_MESSAGES.emergency_stop_active || text.startsWith("Emergency stop is on.")) {
    return "emergency_stop_active";
  }
  if (text === HONEST_FAILURE_MESSAGES.database_write_failed || text.includes("could not be saved")) {
    return "database_write_failed";
  }
  if (text === HONEST_FAILURE_MESSAGES.auth_required || text === "Unauthorized" || text.includes("Sign in is required")) {
    return "auth_required";
  }
  if (
    text === HONEST_FAILURE_MESSAGES.forbidden_cross_site ||
    text.includes("cross-site request blocked") ||
    /^Forbidden:\s*cross-site/i.test(text)
  ) {
    return "forbidden_cross_site";
  }
  if (IMAGE_GENERATION_FAILURE_MARKERS.some((marker) => text.includes(marker)) || /^Image generation failed \(HTTP /i.test(text)) {
    return "image_generation_failed";
  }
  if (/rate limited/i.test(text) || /\b429\b/.test(text)) {
    return "rate_limited";
  }
  if (CHAT_TIMEOUT_MARKERS.some((marker) => text.includes(marker))) {
    return "chat_timeout";
  }
  if (NETWORK_FAILURE_MARKERS.some((marker) => text.includes(marker))) {
    return "network_failure";
  }
  if (MCP_TOOL_FAILURE_PATTERNS.some((pattern) => pattern.test(text)) || MCP_TOOL_FAILURE_MARKERS.some((marker) => text.includes(marker))) {
    return "mcp_tool_failed";
  }
  if (MODEL_UNAVAILABLE_MARKERS.some((marker) => text.includes(marker))) {
    return "model_unavailable";
  }
  if (
    text === HONEST_FAILURE_MESSAGES.mcp_list_failed
    || text.includes("MCP server list could not be loaded")
    || text === HONEST_FAILURE_MESSAGES.mcp_tools_list_failed
    || text.includes("MCP tools list could not be loaded")
    || text === HONEST_FAILURE_MESSAGES.pc_approvals_list_failed
    || text.includes("PC shell approvals list could not be loaded")
    || text === HONEST_FAILURE_MESSAGES.worker_health_failed
    || text.includes("worker status could not be read")
    || text === HONEST_FAILURE_MESSAGES.pc_approve_failed
    || text.includes("PC shell approval could not be completed")
    || text === HONEST_FAILURE_MESSAGES.pc_deny_failed
    || text.includes("PC shell denial could not be completed")
  ) {
    return "network_failure";
  }
  return null;
}

export function honestFailureDescription(kind: HonestFailureKind, message?: string): string {
  if (message?.trim()) return message.trim();
  switch (kind) {
    case "model_unavailable":
      return HONEST_FAILURE_MESSAGES.model_unreachable;
    case "database_write_failed":
      return HONEST_FAILURE_MESSAGES.database_write_failed;
    case "emergency_stop_active":
      return HONEST_FAILURE_MESSAGES.emergency_stop_active;
    case "mcp_tool_failed":
      return HONEST_FAILURE_MESSAGES.mcp_tool_failed;
    case "chat_timeout":
      return HONEST_FAILURE_MESSAGES.chat_timeout;
    case "network_failure":
      return HONEST_FAILURE_MESSAGES.network_failure;
    case "auth_required":
      return HONEST_FAILURE_MESSAGES.auth_required;
    case "forbidden_cross_site":
      return HONEST_FAILURE_MESSAGES.forbidden_cross_site;
    case "rate_limited":
      return HONEST_FAILURE_MESSAGES.rate_limited;
    case "image_generation_failed":
      return HONEST_FAILURE_MESSAGES.image_generation_failed;
  }
}

export function honestFailureAuditAction(kind: HonestFailureKind): string {
  return HONEST_FAILURE_ACTIONS[kind];
}

/**
 * Map a thrown client/network error to existing honest copy, then leave classifyHonestFailure
 * to pick the banner kind. Offline wins over a bare "Failed to fetch".
 */
export function normalizeClientFailureMessage(caught: unknown): string {
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
    return HONEST_FAILURE_MESSAGES.network_offline;
  }
  const raw =
    caught instanceof Error
      ? caught.message
      : typeof caught === "string"
        ? caught
        : "";
  const text = raw.trim();
  if (!text) return HONEST_FAILURE_MESSAGES.network_failure;
  if (text === "Unauthorized" || /sign in is required/i.test(text)) {
    return HONEST_FAILURE_MESSAGES.auth_required;
  }
  if (/cross-site request blocked/i.test(text)) {
    return HONEST_FAILURE_MESSAGES.forbidden_cross_site;
  }
  if (/rate limited/i.test(text)) {
    return text.includes("Nothing was substituted") ? text : HONEST_FAILURE_MESSAGES.rate_limited;
  }
  if (/Failed to fetch|NetworkError|fetch failed|Load failed|ERR_NETWORK|ECONNREFUSED/i.test(text)) {
    return text.includes("Failed to fetch") ? "Failed to fetch" : HONEST_FAILURE_MESSAGES.network_failure;
  }
  return text;
}

/** Retry keeps the same parameters object identity for the caller's closure to re-invoke. */
export function bindRetry<T extends unknown[]>(action: (...args: T) => void, args: T): () => void {
  return () => action(...args);
}

/**
 * Shape shared by the MCP integration results: mcpCommand (ok/error/text/needsConfirmation),
 * callRegistryTool (status/ok/serverId/tool/text), and the built-in tool handlers (status/ok/text).
 */
export type McpToolCallOutcome = {
  ok: boolean;
  status?: "running" | "ok" | "error";
  text?: string;
  error?: string;
  tool?: string;
  serverId?: string;
  needsConfirmation?: boolean;
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Banner 5: an MCP tool call that came back failed. Returns null for success, a pending
 * confirmation (nothing was called yet, not a failure), or a still-running call.
 * The description is one line and keeps the server's honest copy unchanged.
 */
export function mcpToolFailure(outcome: McpToolCallOutcome): { kind: "mcp_tool_failed"; message: string; target: string } | null {
  if (outcome.needsConfirmation) return null;
  if (outcome.status === "running") return null;
  if (outcome.ok && outcome.status !== "error") return null;
  const detail = oneLine(outcome.error || "") || oneLine(outcome.text || "");
  const tool = outcome.tool?.trim();
  const prefix = tool ? `MCP tool “${tool}” failed.` : "";
  const body = detail || HONEST_FAILURE_MESSAGES.mcp_tool_failed;
  const message = prefix ? `${prefix} ${body}` : classifyHonestFailure(body) === "mcp_tool_failed" ? body : `MCP tool failed. ${body}`;
  const target = outcome.serverId || tool ? `mcp:${outcome.serverId ?? "?"}/${tool ?? "?"}` : "mcp";
  return { kind: "mcp_tool_failed", message, target };
}

/**
 * Banner-only mirror of media-lane mapImagineHttpError (harden.ts).
 * Media owns request/HTTP sanitization; this keeps the red banner honest when
 * the generate route has not yet merged that helper, and prefers server copy
 * when it already matches Imagine failure markers.
 */
export function mapImagineHttpErrorCopy(status: number, message: string): string {
  const raw = typeof message === "string" ? message : "";
  if (status === 401 || status === 403) return HONEST_FAILURE_MESSAGES.image_generation_refused;
  if (status === 429) return HONEST_FAILURE_MESSAGES.image_generation_rate_limited;
  if (status === 400 && /moderat|unsafe|policy|content/i.test(raw)) {
    return HONEST_FAILURE_MESSAGES.image_generation_moderation;
  }
  if (status === 400) return HONEST_FAILURE_MESSAGES.image_generation_invalid;
  if (status === 413) return HONEST_FAILURE_MESSAGES.image_generation_too_large;
  if (status >= 500) return HONEST_FAILURE_MESSAGES.image_generation_failed;
  if (status === 408 || /timeout/i.test(raw)) return HONEST_FAILURE_MESSAGES.image_generation_timeout;
  return `Image generation failed (HTTP ${status || "error"}).`;
}

export type ImageGenerationFailure = {
  kind: "image_generation_failed";
  message: string;
  target: string;
  mode: "generate" | "edit";
  prompt: string;
  imageDataUrl?: string;
  n: number;
};

/** Build banner 4 state from an Imagine / Edit Imagine HTTP or thrown failure. */
export function imageGenerationFailure(input: {
  mode: "generate" | "edit";
  prompt: string;
  status?: number;
  serverError?: string;
  caughtMessage?: string;
  imageDataUrl?: string;
  n?: number;
  target?: string;
}): ImageGenerationFailure {
  const server = oneLine(input.serverError || "");
  const caught = oneLine(input.caughtMessage || "");
  let message: string;
  if (server && classifyHonestFailure(server) === "image_generation_failed") {
    message = server;
  } else if (typeof input.status === "number" && input.status > 0) {
    message = mapImagineHttpErrorCopy(input.status, server || caught);
  } else if (caught && classifyHonestFailure(caught) === "image_generation_failed") {
    message = caught;
  } else if (server) {
    message = mapImagineHttpErrorCopy(0, server);
  } else if (caught) {
    message = caught.includes("Imagine") || caught.includes("Image")
      ? caught
      : HONEST_FAILURE_MESSAGES.image_generation_failed;
  } else {
    message = HONEST_FAILURE_MESSAGES.image_generation_failed;
  }
  message = oneLine(message);
  return {
    kind: "image_generation_failed",
    message,
    target: input.target || (input.mode === "edit" ? "imagine:edit" : "imagine:generate"),
    mode: input.mode,
    prompt: input.prompt,
    imageDataUrl: input.imageDataUrl,
    n: input.n ?? 1,
  };
}

/** Retry fidelity: re-run Imagine with the same prompt/options/(edit) source image. */
export function imagineRetryParams(failure: Pick<ImageGenerationFailure, "mode" | "prompt" | "imageDataUrl" | "n">): {
  mode: "generate" | "edit";
  prompt: string;
  n: number;
  imageDataUrl?: string;
} {
  return {
    mode: failure.mode,
    prompt: failure.prompt,
    n: failure.n,
    ...(failure.mode === "edit" && failure.imageDataUrl ? { imageDataUrl: failure.imageDataUrl } : {}),
  };
}
