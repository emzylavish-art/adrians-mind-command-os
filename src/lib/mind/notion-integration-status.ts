import type { OauthStatusPayload } from "./service-board-status.ts";

export type OwnerNotionSnapshot = { ownerId: string; checkedAt: string; status: OauthStatusPayload };

/** A saved OAuth grant is evidence of authorization, not a successful page read/write. */
export function notionIntegrationStatus(ownerId: string | null, pending: boolean, snapshot: OwnerNotionSnapshot | null) {
  if (pending) return { label: "Checking sign-in", detail: "Waiting for the account to be verified.", checkedAt: null };
  if (!ownerId) return { label: "Sign in required", detail: "Sign in to view your saved Notion authorization and selected workspace.", checkedAt: null };
  if (!snapshot || snapshot.ownerId !== ownerId) return { label: "Checking", detail: "Reading this account’s saved Notion connection.", checkedAt: null };
  const { status, checkedAt } = snapshot;
  if (status.state === "connected") return {
    label: "Authorization saved",
    detail: `${status.workspaceName ? `Workspace: ${status.workspaceName}. ` : ""}A Notion grant is saved for this account. Page access and write permission are checked when you use a feature. This status is not a successful API action.`,
    checkedAt,
  };
  if (status.state === "not_connected") return { label: "Not connected", detail: status.detail, checkedAt };
  if (status.state === "not_configured") return { label: "Not configured", detail: status.detail, checkedAt };
  return { label: "Status unavailable", detail: status.detail || "The connection record could not be read. Check again.", checkedAt };
}
