import { packageChatContent, sanitizeAttachments, type ChatContent, type ImageAttachment } from "./media/index.ts";
import { IMAGINE_MAX_N, sanitizeImaginePrompt } from "./media/harden.ts";
import { generateImagineImages, GROK_IMAGINE_MODEL, resolveImagineModel } from "./media/imagine.ts";
import { runLocalPlan, type LocalTool } from "./local-tools.ts";
import type { Autonomy } from "./policy.ts";
import type { Workspace } from "./types.ts";

export const AGENT_MAX_STEPS = 4;
export const AGENT_DEADLINE_MS = 20_000;
/** Cost brake: max Imagine tool calls per single agent run (loop protection). */
export const AGENT_MAX_IMAGINE_PER_RUN = 4;

export const AGENT_TOOLS = [
  {
    name: "list_projects",
    description: "List project names stored on this device.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_chats",
    description: "List chat titles stored on this device.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "search_notes",
    description: "Find notes on this device that contain a word. This does not search the web.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string" } },
    },
  },
  {
    name: "imagine",
    description: "Generate an image with Grok Imagine from a text prompt. Use when the user asks to create, draw, or imagine a picture. Returns image data the client will show inline.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: { prompt: { type: "string", description: "What to generate." } },
    },
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];

export type AgentToolCall = { id: string; name: string; arguments: unknown };

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: ChatContent }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type AgentModel = (input: { messages: AgentMessage[]; signal: AbortSignal }) => Promise<{ text: string; toolCalls: AgentToolCall[] }>;

export type AgentLogEntry = { step: number; tool: string; ok: boolean; detail: string };

export type AgentToolArgs = { query?: string; prompt?: string };
export type AgentToolResult = { ok: boolean; lines: string[]; images?: ImageAttachment[] };
export type AgentRunResult = { ok: boolean; text: string; log: AgentLogEntry[]; error?: string; images?: ImageAttachment[] };

const STOPPED = "Stopped. The unfinished reply was not saved.";

export function validateToolCall(
  call: AgentToolCall,
): { ok: true; tool: AgentToolName; query?: string; prompt?: string } | { ok: false; error: string } {
  const known = AGENT_TOOLS.find((tool) => tool.name === call.name);
  if (!known) return { ok: false, error: "That tool is not registered." };
  const args = call.arguments == null ? {} : call.arguments;
  if (typeof args !== "object" || Array.isArray(args)) return { ok: false, error: "Tool arguments must be an object." };
  const record = args as Record<string, unknown>;
  if (known.name === "search_notes") {
    if (typeof record.query !== "string" || !record.query.trim()) return { ok: false, error: "search_notes requires a query string." };
    return { ok: true, tool: "search_notes", query: record.query.trim().slice(0, 200) };
  }
  if (known.name === "imagine") {
    if (typeof record.prompt !== "string" || !record.prompt.trim()) return { ok: false, error: "imagine requires a prompt string." };
    const prompt = record.prompt.trim().slice(0, 4000);
    return { ok: true, tool: "imagine", prompt };
  }
  return { ok: true, tool: known.name };
}

export function toProviderMessages(messages: AgentMessage[]) {
  return messages.map((message) => {
    if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

export function readAgentMessage(payload: unknown): { text: string; toolCalls: AgentToolCall[] } {
  const message = (payload as { choices?: { message?: { content?: unknown; tool_calls?: unknown } }[] } | null)?.choices?.[0]?.message;
  const text = typeof message?.content === "string" ? message.content : "";
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const toolCalls: AgentToolCall[] = [];
  for (const call of calls) {
    if (!call || typeof call !== "object") continue;
    const record = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof record.function?.name === "string" ? record.function.name : "";
    let args: unknown = {};
    const raw = record.function?.arguments;
    if (typeof raw === "string") {
      try {
        args = JSON.parse(raw) as unknown;
      } catch {
        args = raw;
      }
    } else if (raw && typeof raw === "object") args = raw;
    toolCalls.push({ id: typeof record.id === "string" ? record.id : `call-${toolCalls.length + 1}`, name, arguments: args });
  }
  return { text, toolCalls };
}

export function buildAgentModelBody(
  messages: AgentMessage[],
  options: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    reasoning_effort?: "low" | "medium" | "high" | "xhigh";
  } = {},
) {
  return {
    model: options.model ?? "grok-4.5",
    messages: toProviderMessages(messages),
    tools: AGENT_TOOLS.map((tool) => ({ type: "function", function: tool })),
    tool_choice: "auto" as const,
    max_tokens: options.max_tokens ?? 500,
    temperature: options.temperature ?? 0.2,
    stream: false as const,
    ...(options.reasoning_effort ? { reasoning_effort: options.reasoning_effort } : {}),
  };
}

function createDefaultExecuteTool(meter: { ownerId: string; sessionId: string }) {
  return (ws: Workspace, tool: AgentToolName, args: AgentToolArgs) => defaultExecuteToolUnmetered(ws, tool, args, meter);
}

async function defaultExecuteToolUnmetered(
  ws: Workspace,
  tool: AgentToolName,
  args: AgentToolArgs,
  meter: { ownerId: string; sessionId: string } = { ownerId: "", sessionId: "agent" },
): Promise<AgentToolResult> {
  if (tool === "imagine") {
    const normalized = sanitizeImaginePrompt(args.prompt ?? "");
    if (!normalized.ok) return { ok: false, lines: [`imagine: ${normalized.error}`] };
    if (!meter.ownerId || meter.ownerId === "anon") {
      return { ok: false, lines: ["imagine: Imagine requires an owner id for spend controls."] };
    }
    const model = resolveImagineModel(GROK_IMAGINE_MODEL);
    // Rate limit + daily spend ledger enforced inside generateImagineImages via meter.
    const generated = await generateImagineImages(
      { prompt: normalized.prompt, n: Math.min(1, IMAGINE_MAX_N), model },
      { meter: { ownerId: meter.ownerId, sessionId: meter.sessionId } },
    );
    if (!generated.ok) return { ok: false, lines: [`imagine: ${generated.error}`] };
    const images: ImageAttachment[] = generated.images.map((image, index) => ({
      dataUrl: image.dataUrl,
      name: `imagine-${index + 1}.${image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg"}`,
      mime: image.mime,
    }));
    return {
      ok: true,
      lines: [
        `imagine: Generated ${images.length} image with ${generated.model}. The client will render it inline; do not invent a fake URL.`,
      ],
      images,
    };
  }
  if (tool !== "list_projects" && tool !== "list_chats" && tool !== "search_notes") {
    return { ok: false, lines: [`${tool}: That tool is not available.`] };
  }
  const local = tool as LocalTool;
  const planned = runLocalPlan(ws, [{ id: local, tool: local, query: args.query }], {
    autonomy: "automatic",
    halted: false,
    tokens: { [local]: `approve:${local}` },
  });
  return { ok: planned.ok, lines: planned.lines };
}

export async function runBoundedAgent(input: {
  ws: Workspace;
  goal: string;
  model: AgentModel;
  signal: AbortSignal;
  autonomy: Autonomy;
  halted: boolean;
  approved: boolean;
  maxSteps?: number;
  deadlineMs?: number;
  now?: () => number;
  /** Optional vision attachments for Orchestrator mode (same packaging as Direct). */
  images?: ImageAttachment[];
  /** Owner id for shared Imagine rate limit (HTTP + agent). */
  imagineOwnerId?: string;
  /** Session id for shared Imagine rate limit. */
  imagineSessionId?: string;
  /** Max Imagine tool invocations in this run (default AGENT_MAX_IMAGINE_PER_RUN). */
  maxImaginePerRun?: number;
  execute?: (ws: Workspace, tool: AgentToolName, args: AgentToolArgs) => AgentToolResult | Promise<AgentToolResult>;
}): Promise<AgentRunResult> {
  const maxSteps = input.maxSteps ?? AGENT_MAX_STEPS;
  const maxImaginePerRun = input.maxImaginePerRun ?? AGENT_MAX_IMAGINE_PER_RUN;
  const imagineOwnerId = (input.imagineOwnerId || "").trim();
  const imagineSessionId = (input.imagineSessionId || "agent").trim() || "agent";
  const started = (input.now ?? Date.now)();
  const deadline = started + (input.deadlineMs ?? AGENT_DEADLINE_MS);
  const now = input.now ?? Date.now;
  const log: AgentLogEntry[] = [];
  const collectedImages: ImageAttachment[] = [];
  const goal = input.goal.trim().slice(0, 2000);
  if (!goal) return { ok: false, text: "", log, error: "Write what the agent should do." };
  if (input.halted) return { ok: false, text: "", log, error: "Emergency stop is on. No new action can run." };
  if (!input.approved) return { ok: false, text: "", log, error: "This agent run was not approved." };

  const execute = input.execute ?? createDefaultExecuteTool({ ownerId: imagineOwnerId, sessionId: imagineSessionId });
  let imagineCalls = 0;
  const images = sanitizeAttachments(input.images ?? []);
  const userContent = packageChatContent(goal, images);
  const messages: AgentMessage[] = [
    {
      role: "system",
      content:
        "You may only call list_projects, list_chats, search_notes, and imagine. list_projects, list_chats, and search_notes read this device. imagine generates an image with Grok Imagine from a prompt. Do not claim a web search, a file change, or a shell command. When you are finished, answer with no tool call."
        + (images.length ? " An image may be attached to the user message; describe it if relevant, then use tools only when needed." : ""),
    },
    { role: "user", content: userContent },
  ];
  let toolsRun = 0;
  while (toolsRun <= maxSteps) {
    if (input.signal.aborted) return { ok: false, text: "", log, error: STOPPED, images: collectedImages.length ? collectedImages : undefined };
    if (now() >= deadline) return { ok: false, text: "", log, error: "The agent stopped because it ran out of time. Nothing was marked finished.", images: collectedImages.length ? collectedImages : undefined };
    let reply: { text: string; toolCalls: AgentToolCall[] };
    try {
      reply = await input.model({ messages, signal: input.signal });
    } catch {
      return { ok: false, text: "", log, error: input.signal.aborted ? STOPPED : "The model did not answer. Nothing was marked finished.", images: collectedImages.length ? collectedImages : undefined };
    }
    if (input.signal.aborted) return { ok: false, text: "", log, error: STOPPED, images: collectedImages.length ? collectedImages : undefined };
    const call = reply.toolCalls[0];
    if (!call) {
      const text = reply.text.trim();
      if (!text) return { ok: false, text: "", log, error: "The model returned an empty reply.", images: collectedImages.length ? collectedImages : undefined };
      return { ok: true, text, log, images: collectedImages.length ? collectedImages : undefined };
    }
    if (toolsRun >= maxSteps) return { ok: false, text: "", log, error: `Stopped after ${maxSteps} tool steps.`, images: collectedImages.length ? collectedImages : undefined };
    toolsRun += 1;
    const parsed = validateToolCall(call);
    if (!parsed.ok) {
      log.push({ step: toolsRun, tool: call.name || "unknown", ok: false, detail: parsed.error });
      return { ok: false, text: "", log, error: parsed.error, images: collectedImages.length ? collectedImages : undefined };
    }
    if (parsed.tool === "imagine") {
      if (imagineCalls >= maxImaginePerRun) {
        const detail = `imagine: Too many Imagine calls in this run (limit ${maxImaginePerRun}).`;
        log.push({ step: toolsRun, tool: "imagine", ok: false, detail });
        return { ok: false, text: "", log, error: detail, images: collectedImages.length ? collectedImages : undefined };
      }
      imagineCalls += 1;
    }
    const executed = await Promise.resolve(
      execute(input.ws, parsed.tool, { query: parsed.query, prompt: parsed.prompt }),
    );
    const detail = executed.lines.join(" ").slice(0, 500);
    log.push({ step: toolsRun, tool: parsed.tool, ok: executed.ok, detail });
    if (executed.images?.length) collectedImages.push(...executed.images);
    if (!executed.ok) return { ok: false, text: "", log, error: detail || "The tool failed.", images: collectedImages.length ? collectedImages : undefined };
    messages.push({ role: "assistant", content: reply.text, toolCalls: [call] });
    messages.push({ role: "tool", toolCallId: call.id, name: parsed.tool, content: detail });
  }
  return { ok: false, text: "", log, error: `Stopped after ${maxSteps} tool steps.`, images: collectedImages.length ? collectedImages : undefined };
}
