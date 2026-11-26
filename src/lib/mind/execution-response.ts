import type { ConsultExecutionReceipt } from "./model-consult.ts";

/** Preserve helper accounting even if the final model fails or its stream stops. */
export async function withExecutionReceipts(response: Response, executions: ConsultExecutionReceipt[]): Promise<Response> {
  if (!executions.length) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  if (!headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json().catch(() => ({ ok: false, error: "The final response could not be read." }));
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify({ ...payload, executions }), { status: response.status, headers });
  }
  const reader = response.body?.getReader();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`event: executions\ndata: ${JSON.stringify({ executions })}\n\n`));
    },
    async pull(controller) {
      if (!reader) { controller.close(); return; }
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader?.cancel(reason).catch(() => undefined); },
  });
  return new Response(body, { status: response.status, headers });
}
