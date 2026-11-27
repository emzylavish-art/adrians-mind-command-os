/** Public, resource-specific observations. Credentials and retrieved content never belong here. */
export type NotionOperation = "search" | "read" | "append";
export type NotionFailureEvidence = {
  operation: NotionOperation;
  httpStatus: number;
  code: string;
  kind: "permission" | "block_limit" | "authorization" | "unavailable" | "other";
  recovery: "review_access" | "workspace_limit" | "retry" | "inspect";
};
export type NotionOperationObservation = {
  workspaceId: string;
  pageId: string;
  pageTitle: string;
  operation: NotionOperation;
  grantGeneration: string;
  ok: boolean;
  wrote: boolean;
  verified: boolean;
  observedAt: string;
  failure?: NotionFailureEvidence;
  chatId?: string;
};

export function classifyNotionFailure(operation: NotionOperation, status: number, body: unknown): NotionFailureEvidence {
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const code = typeof raw.code === "string" && /^[a-z_]{1,80}$/.test(raw.code) ? raw.code : "unknown";
  const message = typeof raw.message === "string" ? raw.message : "";
  const kind = status === 401 ? "authorization"
    : status === 403 && /block.*limit|limit.*block|workspace.*limit|maximum.*blocks/i.test(message) ? "block_limit"
    : status === 403 && /permission|access|capabilit|not authorized/i.test(message) ? "permission"
    : status === 0 || status === 429 || status >= 500 ? "unavailable" : "other";
  const recovery = kind === "authorization" || kind === "permission" ? "review_access"
    : kind === "block_limit" ? "workspace_limit" : kind === "unavailable" ? "retry" : "inspect";
  return { operation, httpStatus: status, code, kind, recovery };
}

export function notionObservationMessage(row: NotionOperationObservation, currentGeneration?: string): string {
  const target = row.pageTitle ? ` on “${row.pageTitle}”` : "";
  if (row.ok) return `Last ${row.operation}${target} succeeded.`;
  if (currentGeneration && currentGeneration !== row.grantGeneration) return `Access updated; ${row.operation}${target} has not been verified with this authorization. Review the action again.`;
  if (row.wrote) return `Notion accepted the append${target}, but verification is incomplete. Inspect the page before trying another write.`;
  if (row.failure?.kind === "permission") return `Last ${row.operation}${target} was denied. Review this workspace’s page access and ${row.operation === "append" ? "Insert content capability" : "read permission"}. Other permitted actions remain available.`;
  if (row.failure?.kind === "block_limit") return `Last ${row.operation}${target} hit a workspace block limit. Review the workspace limit; reconnecting may not help.`;
  if (row.failure?.kind === "authorization") return `Authorization was rejected for ${row.operation}${target}. Reauthorize this workspace.`;
  return `Last ${row.operation}${target} did not complete. Check its activity receipt before retrying.`;
}

export function notionReturnHref(chatId?: string): string | undefined {
  return chatId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(chatId) ? `/?section=chat&chat=${encodeURIComponent(chatId)}` : undefined;
}
