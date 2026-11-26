import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addLocalFile, addProject, createChat, deleteLocalFile, deleteProject, emptyWorkspace, memoriesForChat, mergeMemoryState, mergeWorkspace, normalizeWorkspace, openBotChat, refreshBotChat, packWorkspace, replaceFromArchive, stampWorkspaceEdits, unpackWorkspace } from './workspace.ts';
import { mergeWorkspaceEdits } from './workspace-edits.ts';
import { addAgentFromTemplate, AGENT_TEMPLATES } from './fleet.ts';
import { reviseUserTurn, exportChat } from './transcript.ts';
import { quoteIntoNewChat } from './conversation-actions.ts';
import { relevantMemories } from './memory/relevant.ts';
import { runLocalSkill } from './skills.ts';
import { runLocalPlan } from './local-tools.ts';

test('AA012/013: repeated attachments reuse scoped content and old archives cannot resurrect deleted files', async () => {
  let ws = emptyWorkspace();
  for (let i = 0; i < 10; i++) ws = addLocalFile(ws, { name: 'Blueprint.txt', text: 'DOCUMENT_TEST_ALPHA', projectId: null });
  assert.equal(ws.files.length, 1);
  const copied = createChat(ws, { memory: 'off', temporary: false, autonomy: 'ask', projectId: null });
  copied.chat.messages = [{ id: 'copied-file', role: 'user', at: '2026-11-25', content: 'Copied from Blueprint.txt: DOCUMENT_TEST_ALPHA' }];
  ws = copied.ws;
  const archived = structuredClone(ws);
  const removed = deleteLocalFile(ws, ws.files[0]!.id);
  assert.equal(removed.chats[0]!.messages[0]!.content, 'Copied from Blueprint.txt: DOCUMENT_TEST_ALPHA', 'Library removal does not erase the separately saved conversation copy');
  const packed = await packWorkspace(removed, false);
  const restored = await unpackWorkspace(JSON.stringify(packed));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(mergeWorkspace(restored.workspace, archived).files.length, 0);
  assert.equal(mergeWorkspaceEdits(removed, archived, archived).files.length, 0);
  const explicit = replaceFromArchive(removed, archived);
  assert.equal(explicit.files.length, 1);
  assert.notEqual(explicit.files[0]!.id, archived.files[0]!.id);
  ws = addLocalFile(ws, { name: 'Blueprint.txt', text: 'DOCUMENT_TEST_BETA', projectId: null });
  ws = addLocalFile(ws, { name: 'Blueprint.txt', text: 'DOCUMENT_TEST_ALPHA', projectId: 'other-project' });
  assert.equal(ws.files.length, 3);
});

test('AA022/023: deleting a project unlinks bots and prevents orphaned project-note retrieval', () => {
  const project = addProject(emptyWorkspace(), 'One', '');
  const made = addAgentFromTemplate(project.ws, AGENT_TEMPLATES[0]!.name);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  const withChat = createChat(made.ws, { memory: 'on', temporary: false, autonomy: 'ask', projectId: project.project.id });
  const ws = { ...withChat.ws, agents: withChat.ws.agents.map((agent) => ({ ...agent, projectId: project.project.id })), memories: [{ id: 'secret', scope: 'project' as const, projectId: project.project.id, chatId: null, text: 'PROJECT_ONLY', source: 'fixture', createdAt: '', updatedAt: '', archived: false, versions: [] }] };
  assert.equal(memoriesForChat(ws, withChat.chat).length, 1);
  const deleted = deleteProject(ws, project.project.id);
  assert.equal(deleted.agents[0]!.projectId, null);
  assert.equal(deleted.chats[0]!.projectId, null);
  assert.equal(memoriesForChat(deleted, withChat.chat).length, 0);
  assert.equal(deleted.memories.length, 1);
});

test('AA050–054: stale archives preserve bot revisions, disabled schedules, terminal runs and divergent note history', () => {
  const current = normalizeWorkspace({ ...emptyWorkspace(), agents: [{ id: 'bot', name: 'Bot', version: 3, updatedAt: '2026-11-25T12:00:00Z', instructions: 'new' }], schedules: [{ id: 'job', name: 'Job', enabled: false, intervalMinutes: 60, nextRunAt: '2026-11-26T00:00:00Z' }], runs: [{ id: 'run', agentId: 'bot', state: 'completed', goal: 'done', step: 1, maxSteps: 2 }] });
  const archive = structuredClone(current);
  archive.agents[0]!.version = 1; archive.agents[0]!.instructions = 'old'; archive.agents[0]!.updatedAt = '2026-11-24T12:00:00Z';
  archive.schedules[0]!.enabled = true; archive.runs[0]!.state = 'queued';
  const merged = mergeWorkspace(current, archive);
  assert.equal(merged.agents[0]!.instructions, 'new');
  assert.equal(merged.schedules[0]!.enabled, false);
  assert.equal(merged.runs[0]!.state, 'completed');
  const note = { id: 'note', scope: 'global' as const, projectId: null, chatId: null, text: 'left', source: 'fixture', createdAt: '2026-01-01', updatedAt: '2026-02-01', archived: false, versions: [{ at: '2026-01-01', text: 'base' }] };
  const memory = mergeMemoryState({ ...current, memories: [note] }, { ...archive, memories: [{ ...note, text: 'right', updatedAt: '2026-03-01' }] });
  assert.equal(memory.memories[0]!.text, 'right');
  assert.deepEqual(memory.memories[0]!.versions.map((v) => v.text), ['base', 'left']);
});

test('AA053/073–075: metadata clocks merge independently; edits preserve a recoverable original and exports include configuration', () => {
  const made = createChat(emptyWorkspace(), { memory: 'on', temporary: false, autonomy: 'ask', projectId: null, personalityId: 'custom', customPersonality: 'First line\nSecond line' });
  const chat = { ...made.chat, messages: [{ id: 'u', role: 'user' as const, content: 'old', at: '2026-01-01' }, { id: 'a', role: 'assistant' as const, content: 'original answer', at: '2026-01-02' }] };
  const ws = { ...made.ws, chats: [chat] };
  const stamped = stampWorkspaceEdits(ws, { ...ws, chats: [{ ...chat, title: 'new title' }] }, '2030-01-01T00:00:00Z');
  assert.equal(mergeWorkspace(ws, stamped).chats[0]!.title, 'new title');
  const edited = reviseUserTurn(ws, chat.id, 'u', 'new');
  assert.ok('ws' in edited);
  if (!('ws' in edited)) return;
  const original = edited.ws.chats.find((row) => row.archived);
  assert.equal(original?.messages[1]?.content, 'original answer');
  const quoted = quoteIntoNewChat(ws, chat);
  assert.equal(quoted.ws.chats[0]!.customPersonality, chat.customPersonality);
  assert.match(quoted.ws.chats[0]!.messages[0]!.content, /original answer/);
  const exported = exportChat(ws, chat.id);
  assert.ok('json' in exported);
  if ('json' in exported) assert.equal(JSON.parse(exported.json).chat.customPersonality, chat.customPersonality);
});

test('AA005–007/096–100: ordinary skill execution honors current toggles and retains structured provenance', () => {
  const ws = emptyWorkspace();
  ws.memories = [{ id: 'note', scope: 'global', projectId: null, chatId: null, text: 'SYNTHETIC_COBALT', source: 'fixture', createdAt: '', updatedAt: '2026-01-01', archived: false, versions: [] }];
  assert.equal(runLocalSkill(ws, 'search_notes', 'search my notes SYNTHETIC_COBALT', { notes: false }).ok, false);
  const enabled = runLocalSkill(ws, 'search_notes', 'search my notes SYNTHETIC_COBALT', { notes: true });
  assert.equal(enabled.ok, true); assert.match(enabled.text, /SYNTHETIC_COBALT/);
  const result = runLocalPlan(ws, [{ id: 's1', tool: 'search_notes', query: 'COBALT' }], { autonomy: 'automatic', halted: false, tokens: {} });
  assert.equal(result.results[0]!.records[0]!.id, 'note');
  assert.equal(result.results[0]!.records[0]!.source, 'fixture');
  const made = createChat(ws, { memory: 'on', temporary: true, autonomy: 'ask', projectId: null });
  assert.equal(runLocalPlan(made.ws, [{ id: 's2', tool: 'list_chats' }], { autonomy: 'automatic', halted: false, tokens: {} }).results[0]!.records.length, 0);
});

test('AA070/071: task evidence survives a full preference allowance and equivalent cost vocabulary', () => {
  const notes = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, text: 'Use concise prose.', alwaysApply: true }));
  const selected = relevantMemories([...notes, { id: 'budget', text: 'The project budget is ten.', alwaysApply: false }], 'What is the project pricing?');
  assert.equal(selected.length, 12);
  assert.ok(selected.some((note) => note.id === 'budget'));
});

test('AA021/024: existing bot conversations keep their snapshot until explicit refresh without losing history', () => {
  const made = addAgentFromTemplate(emptyWorkspace(), AGENT_TEMPLATES[0]!.name);
  assert.ok(made.ok); if (!made.ok) return;
  made.agent.memory = 'on'; made.agent.version = 2;
  const opened = openBotChat(made.ws, made.agent.id)!;
  opened.chat.messages = [{ id: 'saved-message', role: 'user', content: 'Keep this history', at: '2026-11-25' }];
  const changed = { ...opened.ws, agents: opened.ws.agents.map((agent) => ({ ...agent, version: 3, memory: 'off' as const, instructions: 'New instructions\nSecond paragraph', knowledge: 'Explicit copied note', chatProvider: 'gemini', chatTier: 'Fast' as const, projectId: 'deleted-project' })) };
  assert.equal(openBotChat(changed, made.agent.id)!.chat.botConfigVersion, 2);
  assert.equal(changed.chats[0]!.memory, 'on');
  const refreshed = refreshBotChat(changed, opened.chat.id).chats[0]!;
  assert.equal(refreshed.botConfigVersion, 3); assert.equal(refreshed.memory, 'off');
  assert.equal(refreshed.botProvider, 'gemini'); assert.equal(refreshed.botKnowledge, 'Explicit copied note');
  assert.equal(refreshed.customPersonality, 'New instructions\nSecond paragraph');
  assert.equal(refreshed.projectId, null); assert.equal(refreshed.messages[0]!.id, 'saved-message');
  assert.equal(memoriesForChat(changed, refreshed).length, 0);
});
