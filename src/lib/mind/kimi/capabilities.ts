export type CapabilityStatus = "fully_integrated" | "limited" | "not_supported" | "planned";

export type KimiCapability = {
  id: string;
  group: "agent" | "tools" | "orchestration" | "extensions" | "git" | "session" | "provider" | "voice";
  label: string;
  status: CapabilityStatus;
  evidence: string;
};

export const KIMI_CAPABILITIES: KimiCapability[] = [
  { id: "task_submit", group: "agent", label: "Submit coding task", status: "fully_integrated", evidence: "Authenticated /api/mind/kimi/session queues a kimi-acp job." },
  { id: "agent_output", group: "agent", label: "Agent output and timeline", status: "fully_integrated", evidence: "Build workspace renders stored ACP events and assistant text." },
  { id: "planning_modes", group: "agent", label: "Plan, explore, and coding modes", status: "not_supported", evidence: "Installed Kimi session/set_mode has not been verified. No mode control is advertised." },
  { id: "file_browse", group: "tools", label: "Browse, read, and save files", status: "fully_integrated", evidence: "Companion file-op jobs enforce allowed roots and return reviewed writes." },
  { id: "file_search", group: "tools", label: "Search approved workspace", status: "limited", evidence: "Bounded path and text search runs on the Companion. It is not a full code index." },
  { id: "file_mutate", group: "tools", label: "Create, rename, and delete files", status: "limited", evidence: "Operations are workspace-bound. Delete and rename require an explicit confirmation flag." },
  { id: "shell", group: "tools", label: "Approved terminal commands", status: "limited", evidence: "Commands run only after a one-time owner approval. ACP reverse terminal RPC stays denied." },
  { id: "web_research", group: "tools", label: "Web research", status: "not_supported", evidence: "No Adrian OS web-research bridge is bound to Kimi ACP." },
  { id: "hooks", group: "tools", label: "Lifecycle hooks", status: "not_supported", evidence: "Kimi hook configuration was not verified or exposed." },
  { id: "subagents", group: "orchestration", label: "Subagents and delegated tasks", status: "not_supported", evidence: "No subagent protocol was verified. Parallel agents are not advertised." },
  { id: "mcp", group: "extensions", label: "MCP servers", status: "limited", evidence: "Adrian OS already has an MCP registry. It is not automatically forwarded into kimi acp." },
  { id: "plugins_skills", group: "extensions", label: "Plugins and skills", status: "not_supported", evidence: "No verified plugin or skill management surface is connected to ACP." },
  { id: "instructions", group: "extensions", label: "Project instructions", status: "limited", evidence: "Instructions are stored with the registered project and prepended to the next task." },
  { id: "git_read", group: "git", label: "Git status, diff, and log", status: "limited", evidence: "Exact read-only Git commands can be submitted through the existing approval terminal." },
  { id: "git_write", group: "git", label: "Commit, branch, and restore", status: "planned", evidence: "Write operations remain manual approved commands. No automatic commit or restore is implemented." },
  { id: "session_create_cancel", group: "session", label: "Create, recover, and cancel sessions", status: "fully_integrated", evidence: "Session queue, refresh recovery, and owner cancellation are implemented." },
  { id: "session_history", group: "session", label: "Rename, archive, and history", status: "limited", evidence: "Owner-scoped file records survive restart. They are not durable cloud history until Postgres is configured." },
  { id: "session_resume_fork", group: "session", label: "ACP resume, load, and fork", status: "not_supported", evidence: "Those ACP methods are not called until an installed Kimi version verifies them." },
  { id: "provider_select", group: "provider", label: "Provider and model selection", status: "limited", evidence: "Profiles can be saved and a model id forwarded. Kimi still authenticates through its local CLI login." },
  { id: "provider_key", group: "provider", label: "Encrypted provider key storage", status: "limited", evidence: "Keys are encrypted with CONNECTOR_TOKEN_SECRET and never returned. They are not injected into Kimi." },
  { id: "voice_transcript", group: "voice", label: "Voice transcript into the same task", status: "limited", evidence: "A transcript submits the active Build task. Audio blocks are not sent to ACP." },
  { id: "voice_audio", group: "voice", label: "Native ACP audio", status: "not_supported", evidence: "The audited ACP capability table reports audio prompt support as false." },
];

export function capabilitySummary(items = KIMI_CAPABILITIES) {
  return {
    fully_integrated: items.filter((item) => item.status === "fully_integrated").length,
    limited: items.filter((item) => item.status === "limited").length,
    not_supported: items.filter((item) => item.status === "not_supported").length,
    planned: items.filter((item) => item.status === "planned").length,
  };
}

export function assertNoFalseAvailability(items = KIMI_CAPABILITIES) {
  const advertised = new Set(["fully_integrated", "limited"]);
  for (const item of items) {
    if (!item.evidence.trim()) throw new Error(`${item.id} has no evidence.`);
    if (!advertised.has(item.status) && /available now|fully working/i.test(item.evidence)) {
      throw new Error(`${item.id} advertises unsupported availability.`);
    }
  }
}
