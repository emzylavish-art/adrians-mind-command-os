export type CappedBodyResponse = {
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  body?: unknown;
};

/** Enforce the raw byte cap while reading, before parsing or redaction. */
export async function readCappedBody(response: CappedBodyResponse, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = response.body as { getReader?: () => ReadableStreamDefaultReader<Uint8Array>; cancel?: () => Promise<void> } | null | undefined;
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void body?.cancel?.().catch(() => undefined);
    return { ok: false };
  }
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0, text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { ok: true, text: text + decoder.decode() };
        total += value.byteLength;
        if (total > maxBytes) {
          // A hostile or broken cancel hook must not delay the cap result.
          void reader.cancel().catch(() => undefined);
          return { ok: false };
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }
  }
  // Compatibility for existing text-only fixture/adapters. Streaming transports
  // expose body so production can stop before materializing the full response.
  const text = await response.text();
  return Buffer.byteLength(text, "utf8") > maxBytes ? { ok: false } : { ok: true, text };
}
