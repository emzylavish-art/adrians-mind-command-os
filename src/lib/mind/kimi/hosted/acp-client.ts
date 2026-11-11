import { spawn } from "node:child_process";

export type KimiProbe = {
  status: "session_created" | "authentication_required" | "failed" | "not_configured";
  command: string;
  version?: string;
  agentName?: string;
  protocolVersion?: number;
  loadSession?: boolean;
  forkAdvertised?: boolean;
  error?: string;
  runtimeVerified: false;
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function probeKimiAcp(command = process.env.KIMI_BIN || "kimi", cwd = process.cwd()): Promise<KimiProbe> {
  if (!command.trim()) return { status: "not_configured", command, error: "Kimi command is not configured.", runtimeVerified: false };
  return await new Promise((resolve) => {
    const child = spawn(command, ["acp"], {
      cwd,
      env: { ...process.env, KIMI_DISABLE_TELEMETRY: "1", KIMI_CODE_NO_AUTO_UPDATE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    let settled = false;
    const seen: KimiProbe = { status: "failed", command, runtimeVerified: false };
    const finish = (probe: KimiProbe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(probe);
    };
    const timer = setTimeout(() => finish({ ...seen, status: seen.version ? "failed" : "failed", error: seen.error || "Kimi ACP did not complete the handshake within 12 seconds." }), 12_000);
    child.on("error", (error) => finish({ status: "not_configured", command, error: error.message, runtimeVerified: false }));
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "adrian-os", version: "0.1" } } })}\n`);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: JsonObject;
        try { message = JSON.parse(line) as JsonObject; } catch { continue; }
        if (message.id === 1 && isObject(message.result)) {
          const info = isObject(message.result.agentInfo) ? message.result.agentInfo : {};
          const caps = isObject(message.result.agentCapabilities) ? message.result.agentCapabilities : {};
          const sessions = isObject(caps.sessionCapabilities) ? caps.sessionCapabilities : {};
          seen.version = typeof info.version === "string" ? info.version : undefined;
          seen.agentName = typeof info.name === "string" ? info.name : undefined;
          seen.protocolVersion = typeof message.result.protocolVersion === "number" ? message.result.protocolVersion : undefined;
          seen.loadSession = caps.loadSession === true;
          seen.forkAdvertised = Object.prototype.hasOwnProperty.call(sessions, "fork");
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd, mcpServers: [] } })}\n`);
        }
        if (message.id === 2) {
          if (isObject(message.error)) {
            const text = typeof message.error.message === "string" ? message.error.message : "Kimi rejected the session.";
            finish({ ...seen, status: /auth/i.test(text) ? "authentication_required" : "failed", error: text });
          } else {
            finish({ ...seen, status: "session_created", error: undefined });
          }
        }
      }
    });
  });
}
