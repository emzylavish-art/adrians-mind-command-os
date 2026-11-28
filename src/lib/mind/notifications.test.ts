import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspace } from "./workspace.ts";
import { DEFAULT_NOTIFICATION_PREFERENCES, isQuietHour, workspaceNotices } from "./notifications.ts";

test("pending approvals are urgent and repeated snapshots do not duplicate activity", () => {
  const ws = emptyWorkspace();
  ws.runs = [{ id: "r", state: "waiting_approval", goal: "Review exact destination", updatedAt: "2026-01-01T00:00:00Z" }] as unknown as typeof ws.runs;
  ws.audit = [{ id: "a", action: "finished", result: "Result ready", target: "r", at: "2026-01-01T00:00:00Z" }];
  ws.audit.push(ws.audit[0]!);
  const notices = workspaceNotices(ws);
  assert.equal(notices.length, 2); assert.equal(notices[0]?.view, "runs"); assert.equal(notices[0]?.urgent, true);
  assert.deepEqual(workspaceNotices(ws).map((n) => n.id), notices.map((n) => n.id));
  assert.equal(workspaceNotices(ws, { ...DEFAULT_NOTIFICATION_PREFERENCES, activity: false })[0]?.urgent, true);
});

test("quiet hours handle overnight intervals without removing urgent history", () => {
  const settings = { ...DEFAULT_NOTIFICATION_PREFERENCES, quietStart: 22, quietEnd: 7 };
  assert.equal(isQuietHour(settings, 23), true); assert.equal(isQuietHour(settings, 6), true); assert.equal(isQuietHour(settings, 12), false);
});

test("new approval identities stay unread even on the same run and identify destination", () => {
  const ws = emptyWorkspace();
  ws.runs = [{ id: "r", agentId: "a", state: "waiting_approval", goal: "Send reviewed content", updatedAt: "2026-01-01T00:00:00Z", pendingApproval: { id: "approval-one", tool: "mail.send", destination: "fixture@example.invalid", expiresAt: "2026-01-01T00:05:00Z" } }] as unknown as typeof ws.runs;
  const first = workspaceNotices(ws)[0]!;
  assert.match(first.detail, /mail.send → fixture@example.invalid/);
  ws.runs[0]!.pendingApproval!.id = "approval-two";
  assert.notEqual(workspaceNotices(ws)[0]!.id, first.id);
  assert.equal(workspaceNotices(ws)[0]!.group, first.group);
});

test("research versions and completed media retain direct authorized destinations", () => {
  const ws = emptyWorkspace();
  ws.chats = [
    { id: "saved", title: "Saved work", messages: [{ id: "image", role: "assistant", content: "Image", at: "2026-01-01T00:00:00Z", images: [{ origin: "generated", blobId: "fixture" }] }] },
    { id: "temporary", title: "Private", temporary: true, messages: [{ id: "private-video", role: "assistant", content: "Video", at: "2026-01-01T00:00:00Z", videoUrl: "https://example.invalid/video" }] },
  ] as typeof ws.chats;
  const reports = [1, 2].map((version) => ({ id: "report", version, question: "Fixture research", at: "2026-01-01T00:00:00Z" }));
  const rows = workspaceNotices(ws, DEFAULT_NOTIFICATION_PREFERENCES, reports);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.view === "chat")?.messageId, "image");
  assert.equal(rows.find((row) => row.view === "chat")?.target, "saved");
  assert.deepEqual(rows.filter((row) => row.view === "research").map((row) => row.id), ["research:report:1", "research:report:2"]);
  assert.equal(workspaceNotices(ws, { ...DEFAULT_NOTIFICATION_PREFERENCES, media: false, research: false }, reports).length, 0);
});

test("one damaged notification setting does not load another account's state", async () => {
  const { notificationIds, readNotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } = await import("./notifications.ts");
  const storage = { getItem: (key: string) => key === "read" ? '["first",false,"second"]' : "broken" };
  assert.deepEqual(notificationIds(storage, "read"), ["first", "second"]);
  assert.deepEqual(notificationIds(storage, "dismissed"), []);
  assert.deepEqual(readNotificationPreferences(storage), DEFAULT_NOTIFICATION_PREFERENCES);
});
