export type CapabilityStatus =
  | "ready"
  | "configured"
  | "unconfigured"
  | "blocked"
  | "local_required"
  | "planned"
  | "paid_required";

export type Capability = {
  id: string;
  name: string;
  status: CapabilityStatus;
  why: string;
};

export const CAPABILITIES: Capability[] = [
  {
    id: "chat.grok",
    name: "Grok chat",
    status: "configured",
    why: "A server key is present. A reply is sent only when you press Send. The model is grok-4.5.",
  },
  {
    id: "chat.openai",
    name: "GPT",
    status: "unconfigured",
    why: "No OpenAI key is stored. It cannot be selected.",
  },
  {
    id: "chat.anthropic",
    name: "Claude",
    status: "unconfigured",
    why: "No Anthropic key is stored. It cannot be selected.",
  },
  {
    id: "chat.gemini",
    name: "Gemini",
    status: "unconfigured",
    why: "No Gemini key is stored. It cannot be selected.",
  },
  {
    id: "chat.openrouter",
    name: "OpenRouter",
    status: "unconfigured",
    why: "No OpenRouter key is stored. It is not a required gateway.",
  },
  {
    id: "chat.local",
    name: "Local model",
    status: "local_required",
    why: "Ollama is not installed here, and the HP EliteBook is not paired.",
  },
  {
    id: "policy",
    name: "Approval policy",
    status: "ready",
    why: "Delete and overwrite ask the owner even in Automatic mode. Emergency stop denies new actions.",
  },
  {
    id: "memory",
    name: "Memory",
    status: "ready",
    why: "Off for every new chat. Notes stay in this browser. Export is a hashed JSON file, not a cloud backup.",
  },
  {
    id: "supabase",
    name: "Dedicated database",
    status: "blocked",
    why: "The free organization already has two active projects. Oak Bridge and BridgePoint are not used.",
  },
  {
    id: "rea",
    name: "REA",
    status: "local_required",
    why: "Pinned CLI rea-agents 6.8.0. Doctor runs and is not healthy on this machine. inspect-artifact does not accept TypeScript. Hopper, Ghidra, IDA, JADX, and Kuna are not installed.",
  },
  {
    id: "pc",
    name: "PC control",
    status: "planned",
    why: "The HP EliteBook is not paired. No commands are sent to it.",
  },
  {
    id: "research",
    name: "Research",
    status: "planned",
    why: "Source files are inspected with the official REA CLI. Web pages are not fetched, and citations are not invented.",
  },
  {
    id: "agents",
    name: "Agent runtime",
    status: "planned",
    why: "Analysis actions call the REA CLI from github.com/morluto/rea. A multi-step task runner is not built. Deletes still ask you.",
  },
  {
    id: "image",
    name: "Image studio",
    status: "paid_required",
    why: "Image generation is a paid API. It is not called.",
  },
  {
    id: "video",
    name: "Video studio",
    status: "paid_required",
    why: "Video generation is a paid API. It is not called.",
  },
  {
    id: "voice",
    name: "Voice",
    status: "configured",
    why: "Speak reads up to 500 characters through the server voice API when you press Speak. It does not run by itself.",
  },
  {
    id: "zapia",
    name: "Zapia / WhatsApp",
    status: "planned",
    why: "Not part of the first core.",
  },
];

export const FORBIDDEN_REFS = ["ybxowvzicirinpdcfyqe", "espmxiitzucooxblmnpr"] as const;
