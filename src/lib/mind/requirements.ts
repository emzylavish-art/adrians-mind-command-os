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
    note: "runResearch refuses when no provider is set. performSearch is the configured path.",
  },
  {
    id: "R-RESEARCH",
    text: "Web research with citations.",
    status: "blocked",
    note: "No search endpoint or key is configured. A check refuses instead of asking Grok. Mocked citation normalization is a separate row.",
  },
  {
    id: "R-RESEARCH-NORMALIZE",
    text: "Search hits are kept only when they have a title and an http(s) URL.",
    status: "verified",
    note: "normalizeCitations and performSearch with a mock fetch. Live search was not called.",
  },
  {
    id: "R-PROVIDER-SELECT",
    text: "Only a configured provider can be selected, and another provider is not substituted.",
    status: "verified",
    note: "providerChoices and chosenProvider. The chat radios follow that list. A stored choice other than grok is ignored.",
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
    status: "implemented",
    note: "runBoundedAgent with a fake model. Tools are list_projects, list_chats, and search_notes. A live Grok tool call was not spent.",
  },
  {
    id: "R-FLEET-WORKER",
    text: "A local worker executes queued agent steps and records events.",
    status: "verified",
    note: "tickFleet tests cover local reads, cancellation, pause, leases, and delegation. The worker does not call a model.",
  },
  {
    id: "R-FLEET-HOSTED",
    text: "A hosted worker process runs agent tasks.",
    status: "blocked",
    note: "scripts/mind-worker.mjs exits without polling when DATABASE_URL is unset. A hosted record is not a running worker.",
  },
  {
    id: "R-GMAIL-ACCOUNTS",
    text: "Multiple Gmail accounts can be connected and used.",
    status: "blocked",
    note: "Records can be stored and stay not_connected. OAuth is not configured. Sends require approval and still do not send.",
  },
  {
    id: "R-BROWSER-DRIVER",
    text: "An agent can open a real page in a browser driver.",
    status: "implemented",
    note: "mind-browser.mjs opened a local HTML document in headless Chromium. The product button was not used on a public site.",
  },
  {
    id: "R-SCHEDULES",
    text: "Due schedules queue a run.",
    status: "verified",
    note: "runDueSchedules. There is no hosted cron process.",
  },
  {
    id: "R-CONNECTIONS",
    text: "Provider connections can be recorded without storing secrets.",
    status: "verified",
    note: "addConnection keeps secretStored false. Unconfigured providers are not selected for chat.",
  },
  {
    id: "R-ZAPIA",
    text: "Zapia / WhatsApp.",
    status: "deferred",
    note: "Out of the first core by owner decision.",
  },
  {
    id: "R-PLAN-GRAPH",
    text: "A local task plan with ordered steps and a delegation cap.",
    status: "verified",
    note: "buildTaskPlan records dependencies. delegationGoals keeps at most two children. The plan does not call a model.",
  },
  {
    id: "R-PINS",
    text: "Pins for chats, agents, projects, and files.",
    status: "verified",
    note: "togglePin writes the browser workspace snapshot. It is not cloud backup.",
  },
  {
    id: "R-PALETTE",
    text: "A command palette that opens destinations, agents, and runs.",
    status: "verified",
    note: "paletteHits is covered by a test. The palette does not call a model.",
  },
  {
    id: "R-CHAT-ROUTE",
    text: "Chat can run a local read or queue a saved bot without calling a model.",
    status: "verified",
    note: "interpretCommand. Gmail, web search, media, and computer requests are refused before a model call. Notion is sent to the server, which refuses when no token is set. Ordinary questions still go to Grok only when you press Send.",
  },
  {
    id: "R-NOTION",
    text: "Notion search and updates from chat.",
    status: "implemented",
    note: "The server can search, read, and append through the Notion API, and an append waits for confirmation. Tests use a fake API. No NOTION_TOKEN is set here, so a live search was not run.",
  },
  {
    id: "R-BUILD",
    text: "A coding workspace that edits a repository and runs commands.",
    status: "blocked",
    note: "The Build page explains the limit. No files are changed and no terminal runs.",
  },
  {
    id: "R-LOCAL-DB",
    text: "A file database on this machine that keeps a project after the process closes.",
    status: "implemented",
    note: "A temporary PGLite directory was closed and reopened. The saved project was still there, and another owner was not returned. The preview file is .data/pglite. It is not a hosted database and not the copy on your phone.",
  },
  {
    id: "R-MCP",
    text: "MCP servers can be saved and used only after a real handshake.",
    status: "implemented",
    note: "A fake server was initialized and its tool list was read. A tool call waits for confirmation. No MCP URL is configured here, so nothing is connected.",
  },
  {
    id: "R-SKILLS",
    text: "A skills list with built-in reads and uninstalled outside skills.",
    status: "implemented",
    note: "Project list runs on this device when it is on. Notion, Gmail, voice, and a cloud browser stay not installed.",
  },
  {
    id: "R-PDF",
    text: "PDF text is extracted from the file.",
    status: "implemented",
    note: "A sample PDF and a compressed stream were read. An empty PDF returned no text. No vision model was called.",
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
