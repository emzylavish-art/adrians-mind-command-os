import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStagedSpeak, loadSpeakSelection } from './staged-pipeline.ts';

function fixture() {
  const calls: string[] = [];
  return { calls, deps: {
    capture: async () => { calls.push('capture'); return { ok: true as const, audioBase64: 'ZmFrZQ==', mime: 'audio/webm' }; },
    transcribe: async (_audio: unknown, provider: string) => { calls.push(`input:${provider}`); return { ok: true as const, text: 'hello', provider }; },
    answer: async () => { calls.push('answer:gemini'); return { ok: true as const, text: 'Hello from fixture', provider: 'Gemini', model: 'fixture-model' }; },
    output: async (_text: string, provider: string) => { calls.push(`output:${provider}`); return { ok: true as const, provider }; },
  } };
}
const input = { selection: { input: 'handy' as const, output: 'browser' as const }, freeOnly: true, isCurrent: () => true, isMuted: () => false };

test('AA014/015/017: local input, independent text answer and browser speech preserve three receipts without an xAI call', async () => {
  const f = fixture(); const result = await runStagedSpeak(input, f.deps);
  assert.equal(result.ok, true);
  assert.deepEqual(f.calls, ['capture', 'input:handy', 'answer:gemini', 'output:browser']);
  assert.deepEqual(result.receipt, { input: 'handy', answer: 'Gemini', model: 'fixture-model', output: 'browser', spoken: true });
});

test('AA016: ending call A and opening B while A answers never plays A in B', async () => {
  const f = fixture(); let generation = 1;
  f.deps.answer = async () => { generation = 2; return { ok: true, text: 'late A', provider: 'Gemini', model: 'fixture-model' }; };
  const result = await runStagedSpeak({ ...input, text: 'A', isCurrent: () => generation === 1 }, f.deps);
  assert.equal(result.ok, false); assert.equal(result.text, 'late A'); assert.equal(f.calls.length, 0);
});

test('mute during a delayed answer prevents speech synthesis and playback', async () => {
  const f = fixture(); let muted = false;
  f.deps.answer = async () => { muted = true; return { ok: true, text: 'saved answer', provider: 'Gemini', model: 'fixture-model' }; };
  const result = await runStagedSpeak({ ...input, text: 'question', isMuted: () => muted }, f.deps);
  assert.equal(result.ok, true); assert.equal(result.receipt.output, 'muted'); assert.equal(result.receipt.spoken, false);
});

test('free-only rejects cloud input before capture or spend; local input remains usable', async () => {
  const f = fixture(); const result = await runStagedSpeak({ ...input, selection: { input: 'openai', output: 'browser' } }, f.deps);
  assert.equal(result.ok, false); assert.deepEqual(f.calls, []);
});

test('free-only preserves a completed answer when the selected cloud output is blocked', async () => {
  const f = fixture(); const result = await runStagedSpeak({ ...input, text: 'question', selection: { input: 'handy', output: 'xai' } }, f.deps);
  assert.equal(result.ok, false); assert.equal(result.text, 'Hello from fixture'); assert.deepEqual(f.calls, ['answer:gemini']);
});

test('permission denial stops before transcription and answer', async () => {
  const f = fixture(); const result = await runStagedSpeak(input, { ...f.deps, capture: async () => ({ ok: false, error: 'Microphone permission denied.' }) });
  assert.equal(result.ok, false); assert.match(result.error!, /permission/); assert.deepEqual(f.calls, []);
});

test('an unavailable selected input does not substitute another engine', async () => {
  const f = fixture(); const result = await runStagedSpeak(input, { ...f.deps, transcribe: async () => ({ ok: false, error: 'Handy is not running.' }) });
  assert.equal(result.ok, false); assert.deepEqual(f.calls, ['capture']);
});

test('selected speech stages survive reload and corrupt values use explicit safe defaults', () => {
  assert.deepEqual(loadSpeakSelection({ getItem: () => JSON.stringify({ input: 'openai', output: 'none' }) }), { input: 'openai', output: 'none' });
  assert.deepEqual(loadSpeakSelection({ getItem: () => 'broken' }), { input: 'handy', output: 'browser' });
});

test('account or call change while capturing stops before any transcription request', async () => {
  const f = fixture(); let owner = 'owner-a';
  const result = await runStagedSpeak({ ...input, isCurrent: () => owner === 'owner-a' }, {
    ...f.deps, capture: async () => { owner = 'owner-b'; return { ok: true, audioBase64: 'ZmFrZQ==', mime: 'audio/webm' }; },
  });
  assert.equal(result.ok, false); assert.deepEqual(f.calls, []);
});
