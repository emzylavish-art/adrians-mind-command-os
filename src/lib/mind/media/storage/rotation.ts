import { orderedEnabledAccounts, loadStorageAccountsConfig } from "./config.ts";
import { resolveStorageAccessTokenAsync, isStorageAccountConnected } from "./credentials.ts";
import { appendStorageAudit } from "./audit.ts";
import { bumpLedgerUsed, readLedgerUsed, setLedgerUsed } from "./ledger.ts";
import { createDefaultProviders } from "./providers/index.ts";
import { sanitizeFolderSegments, sanitizeStorageFileName, sniffMime } from "./safe-name.ts";
import {
  PROVIDER_FILE_LIMITS,
  STORE_MEDIA_MAX_BYTES,
  type AccountPublicStatus,
  type StorageAccountConfig,
  type StorageProvider,
  type StorageQuota,
  type StorageService,
  type StoreMediaInput,
  type StoreMediaResult,
} from "./types.ts";

export type RotationDeps = {
  providers?: Record<StorageService, StorageProvider>;
  env?: Record<string, string | undefined>;
  configPath?: string;
  auditPath?: string;
  ledgerPath?: string;
  fetch?: import("../../connectors/storage-token-refresh.ts").FetchLike;
  nowMs?: number;
};

function nearCap(used: number, fileSize: number, cap: number, threshold: number): boolean {
  return used + fileSize > cap * threshold;
}

async function resolveUsed(
  provider: StorageProvider,
  token: string,
  account: StorageAccountConfig,
  ledgerPath?: string,
): Promise<{ used: number; quota: StorageQuota }> {
  try {
    const quota = await provider.quota(token);
    if (quota.source === "live" && Number.isFinite(quota.usedBytes)) {
      // Keep ledger roughly in sync with live usage (never decreases remote; just mirrors).
      await setLedgerUsed(account.service, account.accountEmail, quota.usedBytes, ledgerPath);
      return { used: quota.usedBytes, quota };
    }
  } catch {
    /* fall through to ledger */
  }
  const used = readLedgerUsed(account.service, account.accountEmail, ledgerPath);
  return { used, quota: { usedBytes: used, totalBytes: account.capBytes, source: "ledger" } };
}

/**
 * Opt-in offload for Imagine images, camera captures, and attachments.
 * Picks Supabase → Drive → Dropbox → OneDrive (configurable order).
 * Switches when used + fileSize > cap × threshold.
 * Files over a provider's per-file limit (Supabase: 50 MiB) skip to the next account.
 * NEVER deletes existing media.
 *
 * Wire from Imagine / camera / attach handlers — see WIRING.md.
 */
export async function storeMedia(input: StoreMediaInput, deps: RotationDeps = {}): Promise<StoreMediaResult> {
  if (!input.ownerId?.trim()) {
    return { ok: false, error: "Sign in is required.", code: "unauthorized" };
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    return { ok: false, error: "Upload body is empty.", code: "invalid_input" };
  }
  if (input.bytes.byteLength > STORE_MEDIA_MAX_BYTES) {
    return {
      ok: false,
      error: `File exceeds the ${STORE_MEDIA_MAX_BYTES} byte upload cap.`,
      code: "invalid_input",
    };
  }

  const fileName = sanitizeStorageFileName(input.fileName);
  const mimeType = input.mimeType?.trim() || sniffMime(input.bytes);
  const folderSegments = sanitizeFolderSegments(input.folderSegments ?? ["media"]);
  const config = loadStorageAccountsConfig(deps.configPath);
  const accounts = orderedEnabledAccounts(config);
  const env = deps.env ?? process.env;
  const providers = deps.providers ?? createDefaultProviders(fetch, env);

  let switchedFrom: StorageService | undefined;
  let switchDetail: string | undefined;
  let sawFileLimitSkip = false;
  let sawCapSkip = false;
  let lastConnectedService: StorageService | undefined;
  let anyConnected = false;

  const noteSkip = (service: StorageService, detail: string) => {
    if (switchedFrom) return;
    switchedFrom = service;
    switchDetail = detail;
  };

  for (const account of accounts) {
    const tokenResult = await resolveStorageAccessTokenAsync(input.ownerId, account.service, { env, fetch: deps.fetch, nowMs: deps.nowMs });
    if (!tokenResult.ok) {
      continue;
    }
    anyConnected = true;
    lastConnectedService = account.service;
    const provider = providers[account.service];
    if (!provider) continue;

    const fileLimit = PROVIDER_FILE_LIMITS[account.service];
    if (typeof fileLimit === "number" && input.bytes.byteLength > fileLimit) {
      sawFileLimitSkip = true;
      noteSkip(account.service, `skipped ${account.service} (file exceeds ${fileLimit} byte per-file limit)`);
      continue;
    }

    const { used, quota } = await resolveUsed(provider, tokenResult.token, account, deps.ledgerPath);
    const cap = account.capBytes > 0 ? account.capBytes : quota.totalBytes || account.capBytes;

    if (nearCap(used, input.bytes.byteLength, cap, config.switchThreshold)) {
      sawCapSkip = true;
      noteSkip(account.service, `switched from ${account.service} (near cap)`);
      continue;
    }

    try {
      const uploaded = await provider.upload({
        accessToken: tokenResult.token,
        bytes: input.bytes,
        fileName,
        mimeType,
        folderSegments,
        mediaKind: input.mediaKind,
      });
      const newUsed = await bumpLedgerUsed(
        account.service,
        account.accountEmail,
        input.bytes.byteLength,
        deps.ledgerPath,
      );
      // Prefer live-used + size when we had a live reading.
      const reportedUsed =
        quota.source === "live" ? used + input.bytes.byteLength : newUsed;

      const switchEvent =
        switchedFrom && switchedFrom !== account.service
          ? `${switchDetail ?? `switched from ${switchedFrom} (near cap)`} → ${account.service}`
          : undefined;

      appendStorageAudit(
        {
          service: account.service,
          accountEmail: account.accountEmail,
          fileName,
          bytes: input.bytes.byteLength,
          remotePathOrId: uploaded.remotePath || uploaded.remoteId,
          usedBytes: reportedUsed,
          capBytes: cap,
          switchEvent,
        },
        deps.auditPath,
      );

      return {
        ok: true,
        service: account.service,
        accountEmail: account.accountEmail,
        remoteId: uploaded.remoteId,
        remotePath: uploaded.remotePath,
        bytes: input.bytes.byteLength,
        usedBytes: reportedUsed,
        capBytes: cap,
        switchedFrom: switchEvent ? switchedFrom : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      // Do not leak tokens if an error message somehow included one.
      const safe = message
        .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/eyJ[A-Za-z0-9._-]+/g, "[REDACTED]");
      return { ok: false, error: safe, code: "upload_failed" };
    }
  }

  if (!anyConnected) {
    return {
      ok: false,
      error:
        "No storage accounts are connected. Connect Supabase Storage (MIND_SUPABASE_URL or SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY), Google Drive, Dropbox, and/or OneDrive on ServiceBoard (or set MIND_GOOGLE_DRIVE_TOKEN / MIND_DROPBOX_TOKEN / MIND_ONEDRIVE_TOKEN).",
      code: "not_connected",
    };
  }

  appendStorageAudit(
    {
      service: lastConnectedService ?? "google_drive",
      accountEmail: "(all)",
      fileName,
      bytes: input.bytes.byteLength,
      remotePathOrId: "(none)",
      usedBytes: 0,
      capBytes: 0,
      switchEvent: "storage_full",
      note: "No account had room; nothing was deleted.",
    },
    deps.auditPath,
  );

  if (sawFileLimitSkip && !sawCapSkip) {
    return {
      ok: false,
      error:
        "The file exceeds the per-file limit on every connected account that could accept it. Nothing was deleted.",
      code: "storage_full",
    };
  }

  return {
    ok: false,
    error:
      "Cloud storage is full across all connected accounts. Nothing was deleted. Free space manually or raise a cap / connect another account.",
    code: "storage_full",
  };
}

export async function storageStatusForOwner(
  ownerId: string,
  deps: RotationDeps = {},
): Promise<AccountPublicStatus[]> {
  const config = loadStorageAccountsConfig(deps.configPath);
  const accounts = orderedEnabledAccounts(config);
  const env = deps.env ?? process.env;
  const providers = deps.providers ?? createDefaultProviders(fetch, env);
  const out: AccountPublicStatus[] = [];

  for (const account of accounts) {
    const tokenResult = await resolveStorageAccessTokenAsync(ownerId, account.service, { env, fetch: deps.fetch, nowMs: deps.nowMs });
    const connected = tokenResult.ok;
    let used = readLedgerUsed(account.service, account.accountEmail, deps.ledgerPath);
    let quotaSource: StorageQuota["source"] = "ledger";
    let detail = connected
      ? `${account.service} connected.`
      : tokenResult.ok === false
        ? tokenResult.detail
        : "Not connected.";

    if (tokenResult.ok) {
      try {
        const health = await providers[account.service].health(tokenResult.token);
        if (!health.connected) {
          detail = health.detail;
        }
        const { used: liveUsed, quota } = await resolveUsed(
          providers[account.service],
          tokenResult.token,
          account,
          deps.ledgerPath,
        );
        used = liveUsed;
        quotaSource = quota.source;
      } catch {
        detail = `${account.service} connected (ledger-only quota; live quota unavailable).`;
      }
    }

    const remaining = Math.max(0, account.capBytes - used);
    out.push({
      service: account.service,
      accountEmail: account.accountEmail,
      enabled: account.enabled,
      order: account.order,
      connected: isStorageAccountConnected(ownerId, account.service, env) && connected,
      detail,
      usedBytes: used,
      capBytes: account.capBytes,
      remainingBytes: remaining,
      nearCap: nearCap(used, 0, account.capBytes, config.switchThreshold),
      quotaSource,
    });
  }
  return out;
}

export { nearCap };
