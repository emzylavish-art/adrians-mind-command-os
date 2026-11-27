export type VideoPollStatus = { ok?: boolean; state?: string; url?: string; model?: string; error?: string };
type PollResult = { kind: "done"; status: VideoPollStatus & { url: string } } | { kind: "failed" | "interrupted" | "timeout" | "stopped"; error: string };
/** Poll an existing operation only. This API intentionally cannot start a generation. */
export async function pollSavedVideo(input: {
  status: () => Promise<{ status: number; body: VideoPollStatus; retryAfter?: number }>;
  current: () => boolean;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  onRetry?: () => void;
  deadlineMs?: number;
}): Promise<PollResult> {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + (input.deadlineMs ?? 8 * 60_000);
  let failures = 0;
  let delay = 5000;
  while (now() < deadline) {
    await wait(Math.min(delay, Math.max(0, deadline - now())));
    if (!input.current()) return { kind: "stopped", error: "Status observation stopped. The provider may still finish the saved operation." };
    if (now() >= deadline) break;
    let response: Awaited<ReturnType<typeof input.status>>;
    try { response = await input.status(); }
    catch { response = { status: 503, body: { error: "The status connection was interrupted." } }; }
    if (!input.current()) return { kind: "stopped", error: "Status observation stopped." };
    if (response.status === 429 || response.status >= 500) {
      if (++failures > 3) return { kind: "interrupted", error: "Video status could not be confirmed. Reopen this saved operation to check again; no new generation was started." };
      delay = Math.max(5000, Math.min(30_000, (response.retryAfter ?? failures * 5) * 1000));
      input.onRetry?.();
      continue;
    }
    const status = response.body;
    if (status.state === "failed") return { kind: "failed", error: status.error ?? "The provider reported that video generation failed." };
    if (response.status < 200 || response.status >= 300 || status.ok !== true) return { kind: "interrupted", error: status.error ?? "Video status is unavailable. The generation outcome remains unconfirmed." };
    if (status.state === "done" && typeof status.url === "string" && status.url.startsWith("https://")) return { kind: "done", status: { ...status, url: status.url } };
    failures = 0; delay = 5000;
  }
  return { kind: "timeout", error: "The video outcome is not confirmed yet. Check the saved operation in Library → Media; do not submit it again." };
}
