import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "adrian-coding";

export function installCodingExtensions(home: string, searchUrl: string): { hookCommand: string; pluginRoot: string } {
  const source = fileURLToPath(new URL("./coding-plugin", import.meta.url));
  const pluginRoot = `${home}/plugins/managed/${PLUGIN_ID}`;
  const proof = `${home}/proof/hooks.jsonl`;
  const hookCommand = `python3 ${source}/hooks/record.py ${proof}`;
  mkdirSync(`${home}/plugins/managed`, { recursive: true });
  mkdirSync(`${home}/agents`, { recursive: true });
  mkdirSync(`${home}/proof`, { recursive: true });
  cpSync(source, pluginRoot, { recursive: true });
  writeFileSync(`${pluginRoot}/kimi.plugin.json`, JSON.stringify({
    name: PLUGIN_ID,
    version: "1.0.0",
    description: "Adrian hooks, research skill, and research subagent for the coding process.",
    skills: "./skills",
    agents: "./agents",
    systemPrompt: "The research-web skill and research-web subagent are available. For a public web question, call WebSearch and then FetchURL, and cite the real URL.",
    hooks: ["SessionStart", "UserPromptSubmit", "SubagentStart", "PostToolUse"].map((event) => ({
      event,
      ...(event === "PostToolUse" ? { matcher: "WebSearch|FetchURL" } : {}),
      command: hookCommand,
    })),
  }, null, 2));
  cpSync(`${source}/agents/research-web.md`, `${home}/agents/research-web.md`);
  writeFileSync(`${home}/plugins/installed.json`, JSON.stringify({
    version: 1,
    plugins: [{
      id: PLUGIN_ID,
      root: pluginRoot,
      enabled: true,
      installedAt: "2026-11-12T14:00:00.000Z",
      updatedAt: "2026-11-12T14:00:00.000Z",
      source: "local-path",
      origin: "custom",
      originalSource: source,
    }],
  }, null, 2));
  writeFileSync(`${home}/config.toml`, [
    "telemetry = false",
    'default_model = "adrian/grok"',
    'default_permission_mode = "yolo"',
    "",
    "[[hooks]]",
    'event = "SessionStart"',
    `command = "${hookCommand}"`,
    "",
    "[[hooks]]",
    'event = "UserPromptSubmit"',
    `command = "${hookCommand}"`,
    "",
    "[[hooks]]",
    'event = "SubagentStart"',
    `command = "${hookCommand}"`,
    "",
    "[[hooks]]",
    'event = "PostToolUse"',
    'matcher = "WebSearch|FetchURL"',
    `command = "${hookCommand}"`,
    "",
    "[services.moonshot_search]",
    `base_url = "${searchUrl}"`,
    'api_key = "adrian-local"',
    "",
    "[providers.adrian]",
    'type = "openai"',
    'base_url = "https://api.x.ai/v1"',
    'api_key_env = "XAI_API_KEY"',
    "",
    '[models."adrian/grok"]',
    'provider = "adrian"',
    'model = "grok-4.7"',
    "max_context_size = 131072",
    'capabilities = ["tool_use"]',
    'display_name = "Adrian Grok"',
    "",
  ].join("\n"));
  return { hookCommand, pluginRoot };
}
