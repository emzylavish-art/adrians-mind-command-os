/**
 * N2: Orchestrator mode end-to-end against a stubbed local Ollama conductor
 * (http://127.0.0.1:* with /api/tags + /api/chat shape). Never installs or runs models.
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it } from "node:test";
import { LiveVoiceSession } from "./live-session.ts";
import { setLiveVoiceOccupied } from "./occupancy.ts";
import { runOllamaConductor, OLLAMA_UNREACHABLE } from "../voice/ollama-conductor.ts";
import { probeOllamaForBadge } from "./ollama-status.ts";
import { voiceModeLabel } from "../voice/mode.ts";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: MessageEvent | Event) => void>>();
  addEventListener(type: string, listener: (event: MessageEvent | Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    for (const listener of this.listeners.get("close") ?? []) listener(new Event("close"));
  }
  openNow() {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) listener(new Event("open"));
  }
  emitMessage(payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) listener(event);
  }
}

type ChatBody = { messages?: Array<{ role?: string; content?: string }> };

async function startStubOllama(opts: {
  reply?: string;
  failChat?: boolean;
}): Promise<{ base: string; close: () => Promise<void>; chats: string[] }> {
  const chats: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    if (req.method === "GET" && url.startsWith("/api/tags")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "stub-conductor" }] }));
      return;
    }
    if (req.method === "POST" && url.startsWith("/api/chat")) {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        let body: ChatBody = {};
        try {
          body = JSON.parse(raw) as ChatBody;
        } catch {
          body = {};
        }
        const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
        chats.push(user);
        if (opts.failChat) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "down" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            model: "stub-conductor",
            message: { role: "assistant", content: opts.reply ?? "Conductor heard you." },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no stub address");
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    base,
    chats,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const okProbe = async () => ({ ok: true as const });

describe("N2 Orchestrator ↔ stub Ollama conductor", () => {
  it("transcript → conductor → force_message on shared speaker path; badge Orchestrator", async () => {
    setLiveVoiceOccupied(false);
    const stub = await startStubOllama({ reply: "Short spoken reply from conductor." });
    let created: FakeSocket | undefined;
    const assistants: string[] = [];
    const notices: string[] = [];
    const session = new LiveVoiceSession(
      {
        onAssistantTranscript: (t) => assistants.push(t),
        onNotice: (n) => notices.push(n),
      },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "orchestrator",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        runConductor: (text, cfg) =>
          runOllamaConductor(text, {
            ...cfg,
            baseUrl: stub.base,
            model: "stub-conductor",
          }),
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );

    await session.start();
    assert.equal(session.state.modeBadge, "Orchestrator");
    assert.equal(voiceModeLabel("orchestrator"), "Orchestrator");

    const badge = await probeOllamaForBadge({ baseUrl: stub.base });
    assert.equal(badge.ok, true);

    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello conductor path",
    });

    // Wait for async conductor + speakForce
    for (let i = 0; i < 50 && assistants.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.deepEqual(stub.chats, ["hello conductor path"]);
    assert.deepEqual(assistants, ["Short spoken reply from conductor."]);
    assert.ok(
      created!.sent.some((line) => line.includes("force_message") && line.includes("Short spoken reply")),
      "conductor reply must go through force_message (shared speaker path)",
    );
    assert.equal(session.state.modeBadge, "Orchestrator");
    assert.ok(!notices.some((n) => /unreachable/i.test(n)));

    session.end();
    await stub.close();
    setLiveVoiceOccupied(false);
  });

  it("conductor down surfaces a clear Orchestrator message (no cloud fallback)", async () => {
    setLiveVoiceOccupied(false);
    let created: FakeSocket | undefined;
    const notices: string[] = [];
    const assistants: string[] = [];
    const session = new LiveVoiceSession(
      {
        onNotice: (n) => notices.push(n),
        onAssistantTranscript: (t) => assistants.push(t),
      },
      {
        mintSecret: async () => ({ ok: true, value: "ephemeral", expiresAt: Date.now() + 60_000 }),
        isOverlayMicOpen: () => false,
        getMode: () => "orchestrator",
        getVoiceId: () => "eve",
        probeMic: okProbe,
        skipMic: true,
        runConductor: (text, cfg) =>
          runOllamaConductor(text, {
            ...cfg,
            // Closed port — fetch fails → unreachable
            baseUrl: "http://127.0.0.1:9",
            timeoutMs: 500,
          }),
        socketFactory: () => {
          created = new FakeSocket();
          queueMicrotask(() => created?.openNow());
          return created!;
        },
      },
    );

    await session.start();
    assert.equal(session.state.modeBadge, "Orchestrator");
    created!.emitMessage({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "are you there",
    });
    for (let i = 0; i < 50 && notices.length < 1; i++) {
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.ok(notices.some((n) => n === OLLAMA_UNREACHABLE || /Ollama|unreachable|conductor/i.test(n)));
    assert.equal(assistants.length, 0);
    assert.ok(
      !created!.sent.some((line) => line.includes("force_message")),
      "must not speak via cloud when conductor is down",
    );
    assert.equal(session.state.modeBadge, "Orchestrator");
    session.end();
    setLiveVoiceOccupied(false);
  });
});
