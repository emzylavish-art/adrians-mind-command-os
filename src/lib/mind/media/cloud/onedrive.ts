import { SERVICE_BOARD_HINT, type CloudFetchResult, type CloudListResult } from "./types.ts";

/** OneDrive is intentionally stubbed until MCP Integration adds a connection + OAuth path. */
export function listOneDriveFiles(_input: { token?: string }): CloudListResult {
  return {
    ok: false,
    error: `OneDrive browse is not implemented yet. ${SERVICE_BOARD_HINT}`,
    state: "unsupported",
  };
}

export function fetchOneDriveFile(_input: { token?: string; fileId: string; name: string }): CloudFetchResult {
  return {
    ok: false,
    error: `OneDrive download is not implemented yet. ${SERVICE_BOARD_HINT}`,
  };
}
