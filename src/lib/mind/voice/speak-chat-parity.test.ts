import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const app = readFileSync(new URL("../../../components/mind/command-app.tsx", import.meta.url), "utf8");
const stage = readFileSync(new URL("../../../components/mind/speak-stage.tsx", import.meta.url), "utf8");

describe("Speak and chat parity", () => {
  it("prepares images with the normal chat attachment path and keeps Speak mounted", () => {
    assert.match(app, /onAttachImage=\{addImageAttachment\}/);
    assert.match(app, /attachments=\{pendingImages\.map/);
    assert.match(stage, /Speak stays open/);
    assert.doesNotMatch(stage, /props\.onAttachImage\(file\)[\s\S]{0,500}props\.onClose\(\)/);
  });

  it("sends the captured Speak images through the normal deliver pipeline and clears only after success", () => {
    assert.match(app, /const attachments = options\?\.answerRequest \? \[\] : snapshotImages\(pendingImagesRef\.current\)/);
    assert.match(app, /deliver\(\{ \.\.\.chat, personalityId: spokenStyle \}, transcript, source, Boolean\(replay\), attachments/);
    assert.match(app, /if \(attachments\.length\) \{\s+setImagesInScope\(attachmentScope, attachmentPersist, current => current\.filter/);
  });

  it("uses the same chat turn for typed Speak requests without a hard-coded unpaired-PC refusal", () => {
    const handler = app.slice(app.indexOf("onAsk={async (text, context)"), app.indexOf("      />", app.indexOf("onAsk={async (text, context)")));
    assert.match(handler, /speakChatTurn\(text, \{ stay: true \}\)/);
    assert.doesNotMatch(handler, /paired: false|decideComputerAction/);
  });

  it("uses the selected orchestrator and helper plan when Speak is in orchestrator mode", () => {
    assert.match(app, /selectedProviderOnly: resolveSendPath\(composerEffort\)\.path !== "orchestrator"/);
    assert.match(app, /planModelConsult\(\{ orchestrator: savedRoute\?\.provider \?\? consultModel, modules: consultModules/);
  });

  it("routes live transcripts through the normal chat turn without a separate Ollama-only answer path", () => {
    const handler = app.slice(app.indexOf("async function handleVoiceTranscript"), app.indexOf("  function clearStageTimeout", app.indexOf("async function handleVoiceTranscript")));
    assert.match(handler, /speakChatTurn\(text, \{ stay: true \}\)/);
    assert.doesNotMatch(handler, /runOllamaConductor|if \(mode === "direct"\) return/);
    assert.match(app, /transcriptOnly: true/);
  });
});
