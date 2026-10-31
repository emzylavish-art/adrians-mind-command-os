export type ReqStatus = "verified" | "implemented" | "blocked" | "planned" | "deferred";

/** Inventory of this repository. The original blueprint files are not here, so this list is not a certified copy of that blueprint. */

export type Requirement = {
  id: string;
  text: string;
  status: ReqStatus;
  note: string;
};

export const REQUIREMENTS: Requirement[] = [
  {
    id: "R-2.3-DEFAULT-OFF",
    text: "A new chat defaults to memory off.",
    status: "verified",
    note: "createChat stores memory off unless the owner chooses otherwise.",
  },
  {
    id: "R-2.3-NO-RETRIEVE",
    text: "Memory off retrieves nothing and the model request rejects smuggled notes.",
    status: "verified",
    note: "memoriesForChat and assembleTurn.",
  },
  {
    id: "R-2.3-NO-AUTO-WRITE",
    text: "Creating a chat does not write durable memory.",
    status: "verified",
    note: "Memory is added only by addMemory.",
  },
  {
    id: "R-2.4-EXPORT",
    text: "Workspace export has a hash and rejects a tampered archive.",
    status: "verified",
    note: "Browser archive. Not a cloud backup.",
  },
  {
    id: "R-2.5-ASK",
    text: "New chats default to Ask mode.",
    status: "verified",
    note: "createChat defaults to ask when the caller passes ask.",
  },
  {
    id: "R-2.6-DELETE",
    text: "Delete asks the owner in Ask and Automatic mode.",
    status: "verified",
    note: "Policy engine. Deletes still ask even in Automatic mode.",
  },
  {
    id: "R-2.6-TOKEN",
    text: "A mismatched approval token does not authorize a protected action.",
    status: "verified",
    note: "decide().",
  },
  {
    id: "R-2.6-HALT",
    text: "Emergency stop denies new actions.",
    status: "verified",
    note: "decide() when halted.",
  },
  {
    id: "R-2.8-ISOLATION",
    text: "Boot refuses Oak Bridge and BridgePoint project refs.",
    status: "verified",
    note: "guardMindEnv. No connection is opened to either project.",
  },
  {
    id: "R-SCOPE",
    text: "Memory on sees only global, the chat's project, and that chat.",
    status: "verified",
    note: "memoriesForChat.",
  },
  {
    id: "R-15-DATABASE",
    text: "Dedicated Supabase project for Mind.",
    status: "blocked",
    note: "Free org already has two active projects. Existing projects are not paused or reused.",
  },
  {
    id: "R-PROVIDERS",
    text: "GPT, Claude, Gemini, and OpenRouter adapters.",
    status: "blocked",
    note: "No keys are stored. They are not called.",
  },
  {
    id: "R-GROK",
    text: "One real Grok chat adapter.",
    status: "implemented",
    note: "Called only when you send. Usage is recorded from the response.",
  },
  {
    id: "R-REA",
    text: "REA reverse-engineering tool.",
    status: "implemented",
    note: "Pinned rea-agents 6.8.0. Doctor is not healthy. inspect-artifact rejects TypeScript. analyze-javascript-application failed here because ps is not on PATH. Native engines are not installed.",
  },
  {
    id: "R-PC",
    text: "HP EliteBook local agent.",
    status: "blocked",
    note: "This browser is not the HP. No device is paired.",
  },
  {
    id: "R-MEDIA",
    text: "Image and video studios.",
    status: "blocked",
    note: "Paid APIs. Not called.",
  },
  {
    id: "R-VOICE",
    text: "Speak a reply on request.",
    status: "implemented",
    note: "xAI voice, 500 characters, only when Speak is pressed. It does not run on its own.",
  },
  {
    id: "R-CHAT-EDIT",
    text: "Editing a user message drops later messages and does not leave a duplicate.",
    status: "verified",
    note: "reviseUserTurn.",
  },
  {
    id: "R-CHAT-REGEN",
    text: "Regenerate drops only the last assistant reply.",
    status: "verified",
    note: "prepareRegenerate.",
  },
  {
    id: "R-PROVIDER-ROUTE",
    text: "An unconfigured provider is not silently replaced with Grok.",
    status: "verified",
    note: "resolveProvider.",
  },
  {
    id: "R-LOOKUP",
    text: "A local lookup runs approved steps in order and stops when halted.",
    status: "verified",
    note: "Notes, chats, and projects on this device. Not a model agent and not web research.",
  },
  {
    id: "R-AGENTS",
    text: "Multi-step agent runtime.",
    status: "implemented",
    note: "Workspace lookup runs approved read steps in order. It does not plan with a model, browse the web, or control a computer.",
  },
  {
    id: "R-CHAT-RETRY",
    text: "A failed send can be retried without duplicating the user message.",
    status: "verified",
    note: "prepareRetry resends the last user message only.",
  },
  {
    id: "R-CHAT-STOP",
    text: "Stop this reply aborts the provider request and does not save the unfinished answer.",
    status: "verified",
    note: "Mocked relay and client tests. Stopping one reply is not Emergency stop. A real provider may still charge for tokens generated before it sees the abort.",
  },
  {
    id: "R-CHAT-EXPORT",
    text: "One conversation can be exported as JSON.",
    status: "verified",
    note: "exportChat. The file is a download, not a cloud backup.",
  },
  {
    id: "R-PROVIDER-BODY",
    text: "A named provider other than Grok is refused before a model call.",
    status: "verified",
    note: "assertLiveProvider. An omitted provider stays Grok.",
  },
  {
    id: "R-RESEARCH-GATE",
    text: "Research without a search provider creates no citations and does not call a model.",
    status: "verified",
    note: "runResearch.",
  },
  {
    id: "R-RESEARCH",
    text: "Web research with citations.",
    status: "blocked",
    note: "No search provider or key is configured. The research screen refuses instead of asking Grok.",
  },
  {
    id: "R-VOICE-LIVE",
    text: "A live voice conversation with interruption.",
    status: "blocked",
    note: "Speak and browser dictation exist. Full duplex and turn-taking were not built or tested.",
  },
  {
    id: "R-REA-NATIVE",
    text: "A healthy REA inspection environment, including native engines.",
    status: "blocked",
    note: "Doctor is unhealthy. Node is 22.23.3. ps is missing. Hopper, Ghidra, IDA, JADX, and Kuna were not installed.",
  },
  {
    id: "R-IPHONE",
    text: "Install and use the app on an iPhone 13 Pro.",
    status: "blocked",
    note: "PWA manifest, viewport, and safe-area padding are in the app. No physical device test was run.",
  },
  {
    id: "R-AGENT-PLAN",
    text: "A model that plans multi-step work.",
    status: "planned",
    note: "Not implemented. The integrations list names this separately from local workspace lookup. No model plans a sequence of tools.",
  },
  {
    id: "R-ZAPIA",
    text: "Zapia / WhatsApp.",
    status: "deferred",
    note: "Out of the first core by owner decision.",
  },
];

export function requirementCounts() {
  const counts: Record<ReqStatus, number> = {
    verified: 0,
    implemented: 0,
    blocked: 0,
    planned: 0,
    deferred: 0,
  };
  for (const row of REQUIREMENTS) counts[row.status] += 1;
  return counts;
}
