import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validatePrimaryConfiguration } from "./turn-primary-selection.ts";

const base = { text: "Compare the plan", imageCount: 0, controls: {}, memory: "off", xai: { ok: true } };

test("missing primary credentials, paid/absent OpenRouter model, and stale selected model fail before helpers", () => {
  for (const [input, env, message] of [
    [{ ...base, provider: "openai" }, {}, /No openai key/],
    [{ ...base, provider: "openrouter" }, { OPENROUTER_API_KEY: "fixture", OPENROUTER_MODEL: "paid-model" }, /free/],
    [{ ...base, provider: "gemini", requestedModel: "previous" }, { GEMINI_API_KEY: "fixture" }, /changed/],
    [{ ...base, provider: "grok", xai: { ok: false, error: "key unavailable" } }, {}, /key unavailable/],
    [{ ...base, provider: "ollama", controls: { answerTokens: 1024 } }, { LOCAL_MODEL_URL: "http://localhost:9000/generate" }, /budget contract/],
    [{ ...base, provider: "nemotron", requestedModel: "other" }, { OPENROUTER_API_KEY: "fixture" }, /changed/],
  ] as const) {
    const result = validatePrimaryConfiguration(input, env);
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, message);
  }
});

test("saving chat memory without an explicit destination is rejected before otherwise valid primary/helper work", () => {
  const missing = validatePrimaryConfiguration({ ...base, provider: "openai", memory: "on", saveMemory: "remember this", chatId: " " }, { OPENAI_API_KEY: "fixture" });
  assert.equal(missing.ok, false); if (!missing.ok) assert.match(missing.error, /conversation/);
  assert.equal(validatePrimaryConfiguration({ ...base, provider: "openai", memory: "on", saveMemory: "remember this", chatId: "chat-A" }, { OPENAI_API_KEY: "fixture" }).ok, true);
});

test("custom model identity and capability remain exact; configured normal selections pass without substitution", () => {
  const selected = { ...base, provider: "custom:fixture:vision", requestedModel: "vision", custom: { model: "vision", imageInput: true }, imageCount: 1 };
  assert.deepEqual(validatePrimaryConfiguration(selected, {}), { ok: true, provider: selected.provider, model: "vision", supportsImages: true });
  assert.equal(validatePrimaryConfiguration({ ...selected, requestedModel: "different" }, {}).ok, false);
  assert.equal(validatePrimaryConfiguration({ ...selected, custom: { model: "vision", imageInput: false } }, {}).ok, false);
  assert.equal(validatePrimaryConfiguration({ ...base, provider: "grok", requestedModel: "grok-4.5" }, {}).ok, true);
  assert.deepEqual(validatePrimaryConfiguration({ ...base, provider: "ollama", requestedModel: "local-A", controls: { answerTokens: 1024 } }, { LOCAL_MODEL_URL: "http://localhost:11434/api/generate", OLLAMA_MODEL: "local-A" }), { ok: true, provider: "ollama", model: "local-A", supportsImages: false });
});

test("mounted turn path checks actual primary config and declared context limits before helper dispatch", () => {
  const source = readFileSync(new URL("./turn.server.ts", import.meta.url), "utf8");
  const helpers = source.indexOf("const help = await collectConsultHelp");
  for (const marker of ["const environment = envCheck()", "const primary = validatePrimaryConfiguration(", "if (!primary.ok)", "const contextValidation = directTurnContext", "if (!contextValidation.ok)"]) assert.ok(source.indexOf(marker) > 0 && source.indexOf(marker) < helpers, marker);
  assert.match(source, /contextWindowTokens: selected\.capabilities\?\.contextWindowTokens, maxInputTokens: selected\.capabilities\?\.maxInputTokens/);
  assert.match(source, /capabilities: selectedCapabilities, supportsImages: primary\.supportsImages/);
  assert.match(source, /consultationResponse\(safePrimary, consultation, request\.signal\)/);
  assert.match(source, /try \{ return await finishPrimary\(\); \}/);
});
