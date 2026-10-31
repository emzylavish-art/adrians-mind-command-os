export type ReqStatus = "verified" | "implemented" | "blocked" | "planned" | "deferred";

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
    note: "Policy engine. The server is not a separate database yet.",
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
    note: "rea-agents from github.com/morluto/rea. Doctor and inspect-artifact are callable. Doctor is not healthy: Node needs a newer patch, and Hopper, Ghidra, IDA, JADX, and Kuna are not installed.",
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
    id: "R-AGENTS",
    text: "Multi-step agent runtime.",
    status: "planned",
    note: "REA doctor and inspect are callable. A multi-step task runner is not built.",
  },
  {
    id: "R-RESEARCH",
    text: "Web research with citations.",
    status: "planned",
    note: "No search provider is connected.",
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
