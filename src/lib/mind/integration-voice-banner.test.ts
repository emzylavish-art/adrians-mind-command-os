import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  HONEST_FAILURE_MESSAGES,
  classifyHonestFailure,
  mcpToolFailure,
} from "./failure-states.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const commandApp = readFileSync(join(root, "src/components/mind/command-app.tsx"), "utf8");
const chatPane = readFileSync(join(root, "src/components/mind/chat-pane.tsx"), "utf8");
const chatControls = readFileSync(join(root, "src/components/mind/chat-controls.tsx"), "utf8");
const commandSurface = [commandApp, chatPane, chatControls].join("\n");
const agentRun = readFileSync(join(root, "src/lib/mind/agent-run.server.ts"), "utf8");

describe("integration voice + banner wiring survives merge", () => {
  it("keeps voice-wiring surface in command-app", () => {
    for (const needle of [
      "VoiceLevelMeter",
      "VoiceWaveform",
      "VoiceModeOverlay",
      "commitVoiceMode",
      "applyVoiceMode",
      "formatVoiceClientError",
      "latestVoiceTranscript.current(text, record",
      "speakChatTurn(text, { stay: true })",
      "transcriptOnly: true",
      "matchesVoiceToggleShortcut",
      "VOICE_TOGGLE_SHORTCUT",
      "voiceMicAriaLabel",
      'data-testid="open-voice-mode"',
      'data-testid="voice-mute-mobile"',
    ]) {
      assert.match(commandSurface, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps failure-banner + banner-5 MCP helpers wired in command-app", () => {
    for (const needle of [
      'data-testid="failure-banner"',
      "classifyHonestFailure",
      "HONEST_FAILURE_MESSAGES",
      "reportFailure",
      "mcpToolFailure",
      "async function askMcp",
    ]) {
      assert.match(commandSurface, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // askMcp must raise the honest MCP banner path
    assert.match(commandApp, /mcpToolFailure\(\{[\s\S]*?reportFailure\(failure\.message/);
  });

  it("banner 5 classification still maps MCP failures", () => {
    assert.equal(classifyHonestFailure(HONEST_FAILURE_MESSAGES.mcp_tool_failed), "mcp_tool_failed");
    const failed = mcpToolFailure({ ok: false, status: "error", error: "Nothing was called.", tool: "pglite_query", serverId: "local" });
    assert.ok(failed);
    assert.equal(failed!.kind, "mcp_tool_failed");
    assert.match(failed!.message, /pglite_query/);
  });

  it("keeps sibling lane markers that voice merge must not drop", () => {
    for (const needle of [
      'data-testid="executing-tools"',
      'data-testid="agent-activity-live"',
      "toolTimeline",
      "ModelTierChip",
      "onImagine",
      "runImagine",
      "historyTextForImages",
      "ServiceBoard",
      "fileToDownscaledDataUrl",
    ]) {
      assert.match(commandSurface, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(commandApp, /analyzeImageFile\(/);
    for (const needle of ["resolveXaiInferenceApiKey", "boundAbortSignal", "AGENT_TIMEOUT_REPLY", "agentRunTimeoutMs", "images: result.images"]) {
      assert.match(agentRun, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
