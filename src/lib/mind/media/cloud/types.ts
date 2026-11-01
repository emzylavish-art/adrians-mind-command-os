/** Cloud file sources for composer/library attach. OAuth is owned by MCP Integration. */

export const CLOUD_SOURCES = ["google_drive", "onedrive"] as const;
export type CloudSource = (typeof CLOUD_SOURCES)[number];

export type CloudConnectionState = "connected" | "not_connected" | "not_configured" | "unsupported";

export type CloudConnectionPublic = {
  source: CloudSource;
  state: CloudConnectionState;
  detail: string;
  accountLabel?: string;
  connectedAt?: string;
};

export type CloudFileItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: number;
  source: CloudSource;
};

export type CloudFetchResult =
  | {
      ok: true;
      name: string;
      mimeType: string;
      /** Raw bytes as base64 (no data: prefix). */
      base64: string;
      bytes: number;
      kind: "image" | "text" | "unsupported";
      text?: string;
    }
  | { ok: false; error: string };

export type CloudListResult =
  | { ok: true; files: CloudFileItem[]; nextPageToken?: string }
  | { ok: false; error: string; state?: CloudConnectionState };

/** On-disk record shape compatible with MCP connector store (tokens never sent to the client). */
export type CloudConnectionRecord = {
  connector: CloudSource;
  ownerId: string;
  /** Prefer MCP-encrypted form when present. */
  accessTokenEnc?: string;
  /** Plaintext only for tests / local fixtures — never expose to the browser. */
  accessToken?: string;
  refreshTokenEnc?: string;
  accountLabel?: string;
  connectedAt: string;
};

export const SERVICE_BOARD_HINT =
  "Open ServiceBoard and connect this account there. Cloud OAuth is owned by MCP Integration — this app only browses after a connection record exists.";
