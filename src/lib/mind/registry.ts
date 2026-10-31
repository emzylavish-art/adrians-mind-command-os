export type CapabilityStatus =
  | "ready"
  | "configured"
  | "live_verified"
  | "unconfigured"
  | "blocked"
  | "local_required"
  | "planned"
  | "paid_required";

export function isVerifiedCapability(status: CapabilityStatus): boolean {
  return status === "ready" || status === "live_verified";
}

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
    why: "A server key is present. A live reply was not verified in the last test. A send still uses grok-4.5 only when you press Send.",
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
    why: "DATABASE_URL is not set. The server uses in-memory PGLite, which resets when the process restarts. That is not cloud backup. Oak Bridge and BridgePoint are not used.",
  },
  {
    id: "rea",
    name: "REA",
    status: "blocked",
    why: "Pinned CLI rea-agents 6.8.0 runs, and doctor is not a healthy environment. inspect-artifact does not accept TypeScript. Hopper, Ghidra, IDA, JADX, and Kuna are not installed.",
  },
  {
    id: "pc",
    name: "PC control",
    status: "blocked",
    why: "Not implemented. The HP EliteBook is not paired. No commands are sent to it.",
  },
  {
    id: "research",
    name: "Research",
    status: "unconfigured",
    why: "No search endpoint or key is configured, so a check refuses and does not call Grok. Citation normalization is tested with a mock provider and drops non-http URLs. Live search was not run.",
  },
  {
    id: "agents",
    name: "Local workspace lookup",
    status: "ready",
    why: "Three approved reads run on this device: projects, chats, and notes. Tests cover order and emergency stop. This does not plan with a model.",
  },
  {
    id: "agents.planner",
    name: "AI agent planner",
    status: "configured",
    why: "Bounded to three local reads: projects, chats, and notes. Fake-model tests cover success, bad arguments, denial, timeout, cancellation, tool failure, and the step limit. A live Grok tool call was not verified. It cannot use a shell, the network, or files.",
  },
  {
    id: "agents.worker",
    name: "Local agent worker",
    status: "ready",
    why: "Run worker once executes queued local reads and records events. It does not call a model. Tests cover approval, cancellation, leases, and one-level delegation.",
  },
  {
    id: "agents.hosted",
    name: "Hosted agent worker",
    status: "blocked",
    why: "No hosted worker is provisioned. Recording a hosted target does not start a remote process.",
  },
  {
    id: "browser.inspect",
    name: "Page inspect",
    status: "configured",
    why: "Open page can launch the local headless browser for an http(s) URL. The automated driver check used a local HTML document, not a public website, and the product button was not clicked.",
  },
  {
    id: "gmail",
    name: "Gmail",
    status: "unconfigured",
    why: "Mailbox records stay not connected. Google OAuth is not configured. Nothing is read or sent.",
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
    why: "One-shot Speak exists. It is not a live full-duplex conversation. A live Speak call was not verified in the last test.",
  },
  {
    id: "zapia",
    name: "Zapia / WhatsApp",
    status: "planned",
    why: "Not part of the first core.",
  },
];

export const FORBIDDEN_REFS = ["ybxowvzicirinpdcfyqe", "espmxiitzucooxblmnpr"] as const;
