import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalShareSearch,
  embeddedWorkspaceSearch,
  backShareHistory,
  currentShareSearch,
  forwardShareHistory,
  isShareId,
  navigateShare,
  resolveShare,
  sameShareLocation,
  shareMissLabel,
  shareWriteForView,
  shareWriteDropsMissing,
  startShareHistory,
  writeShareSearch,
} from "./app-location.ts";

const sections = ["command", "chat", "projects", "files", "agents", "settings"];

it("returns from embedded tools to workspace selectors and discards unrelated search values", () => {
  assert.equal(embeddedWorkspaceSearch("?section=chat&chat=fixture-1&token=synthetic&resume=speak"), "?section=chat&chat=fixture-1");
  assert.equal(embeddedWorkspaceSearch("?section=files&file=fixture-2"), "?section=files&file=fixture-2");
  assert.equal(embeddedWorkspaceSearch("?section=%2F%2Fevil.invalid&chat=%2Fescape"), "");
});
const catalog = {
  chats: [{ id: "chat-1" }],
  projects: [{ id: "project-1" }],
  files: [{ id: "file-1" }],
  agents: [{ id: "bot-1" }, { id: "bot-old", archived: true }],
};

describe("share location", () => {
  it("keeps section history and adds one chat id", () => {
    const search = writeShareSearch("?section=settings&mode=agent", shareWriteForView("chat", {
      chat: "chat-1",
      project: "project-1",
      file: "file-1",
      bot: "bot-1",
    }), sections);
    assert.equal(search, "?section=chat&chat=chat-1&mode=agent");
  });

  it("omits the command section and still keeps a home chat", () => {
    const search = writeShareSearch("?section=files&file=file-1", shareWriteForView("command", {
      chat: "chat-1",
      project: null,
      file: "file-1",
      bot: null,
    }), sections);
    assert.equal(search, "?chat=chat-1");
  });

  it("writes one project, file, or bot without the other item ids", () => {
    assert.equal(writeShareSearch("", shareWriteForView("projects", {
      chat: "chat-1",
      project: "project-1",
      file: null,
      bot: null,
    }), sections), "?section=projects&project=project-1");
    assert.equal(writeShareSearch("", shareWriteForView("files", {
      chat: null,
      project: null,
      file: "file-1",
      bot: null,
    }), sections), "?section=files&file=file-1");
    assert.equal(writeShareSearch("", shareWriteForView("agents", {
      chat: null,
      project: null,
      file: null,
      bot: "bot-1",
    }), sections), "?section=agents&bot=bot-1");
  });

  it("rejects ids that could escape the query and leaves the handoff key alone", () => {
    assert.equal(isShareId("chat-1"), true);
    assert.equal(isShareId("../secret"), false);
    assert.equal(isShareId("a b"), false);
    assert.equal(isShareId(""), false);
    const search = writeShareSearch("?agentId=persona-1&mode=agent", shareWriteForView("agents", {
      chat: null,
      project: null,
      file: null,
      bot: "bot/../x",
    }), sections);
    assert.equal(search, "?section=agents&agentId=persona-1&mode=agent");
  });

  it("treats the same link as the same location regardless of parameter order", () => {
    assert.equal(canonicalShareSearch("?chat=chat-1&section=chat"), canonicalShareSearch("?section=chat&chat=chat-1"));
    assert.equal(sameShareLocation("/", "", "?section=files&file=file-1", "?file=file-1&section=files"), true);
  });

  it("restores a known item and does not invent a missing one", () => {
    const found = resolveShare("?section=files&file=file-1", catalog, sections);
    assert.equal(found.view, "files");
    assert.equal(found.fileId, "file-1");
    assert.deepEqual(found.missing, []);
    const missing = resolveShare("?section=chat&chat=missing", catalog, sections);
    assert.equal(missing.chatId, null);
    assert.deepEqual(missing.missing, ["chat"]);
    assert.equal(shareMissLabel(missing.missing), "This link points at a chat that is not on this device. Nothing was created.");
  });

  it("infers the section from one item and falls back when the section is unknown", () => {
    assert.equal(resolveShare("?bot=bot-1", catalog, sections).view, "agents");
    assert.equal(resolveShare("?section=not-a-view", catalog, sections).view, "command");
  });

  it("focuses an archived bot without treating it as missing", () => {
    const resolved = resolveShare("?section=agents&bot=bot-old", catalog, sections);
    assert.equal(resolved.botId, "bot-old");
    assert.equal(resolved.botArchived, true);
    assert.equal(resolved.focusId, "bot-bot-old");
    assert.deepEqual(resolved.missing, []);
  });

  it("marks each missing id without creating a chat, project, file, or bot", () => {
    const before = structuredClone(catalog);
    const cases = [
      ["?section=chat&chat=missing-chat", "chat", "This link points at a chat that is not on this device. Nothing was created."],
      ["?section=projects&project=missing-project", "project", "This link points at a project that is not on this device. Nothing was created."],
      ["?section=files&file=missing-file", "file", "This link points at a file that is not on this device. Nothing was created."],
      ["?section=agents&bot=missing-bot", "bot", "This link points at a bot that is not on this device. Nothing was created."],
    ] as const;
    for (const [search, key, label] of cases) {
      const resolved = resolveShare(search, catalog, sections);
      assert.equal(resolved.chatId, null);
      assert.equal(resolved.projectId, null);
      assert.equal(resolved.fileId, null);
      assert.equal(resolved.botId, null);
      assert.equal(resolved.focusId, null);
      assert.deepEqual(resolved.missing, [key]);
      assert.equal(shareMissLabel(resolved.missing), label);
    }
    assert.deepEqual(catalog, before);
  });

  it("restores the previous section and item on back without keeping a missing id", () => {
    let history = startShareHistory("?section=settings");
    history = navigateShare(history, "chat", { chat: "chat-1", project: null, file: null, bot: null }, sections);
    history = navigateShare(history, "files", { chat: null, project: null, file: "missing-file", bot: null }, sections);
    const missing = resolveShare(currentShareSearch(history), catalog, sections);
    assert.deepEqual(missing.missing, ["file"]);
    assert.equal(missing.fileId, null);
    assert.equal(catalog.files.length, 1);

    history = backShareHistory(history);
    const restored = resolveShare(currentShareSearch(history), catalog, sections);
    assert.equal(restored.view, "chat");
    assert.equal(restored.chatId, "chat-1");
    assert.deepEqual(restored.missing, []);

    history = backShareHistory(history);
    assert.equal(currentShareSearch(history), "?section=settings");
    assert.equal(backShareHistory(history), history);

    history = forwardShareHistory(history);
    assert.equal(resolveShare(currentShareSearch(history), catalog, sections).chatId, "chat-1");
    history = forwardShareHistory(history);
    const returned = resolveShare(currentShareSearch(history), catalog, sections);
    assert.equal(returned.fileId, null);
    assert.deepEqual(returned.missing, ["file"]);
    assert.equal(catalog.files.length, 1);
  });

  it("walks back through a project and a bot without inventing either record", () => {
    let history = startShareHistory("");
    history = navigateShare(history, "projects", { chat: null, project: "project-1", file: null, bot: null }, sections);
    history = navigateShare(history, "agents", { chat: null, project: null, file: null, bot: "missing-bot" }, sections);
    assert.deepEqual(resolveShare(currentShareSearch(history), catalog, sections).missing, ["bot"]);
    history = backShareHistory(history);
    const project = resolveShare(currentShareSearch(history), catalog, sections);
    assert.equal(project.view, "projects");
    assert.equal(project.projectId, "project-1");
    assert.equal(catalog.projects.length, 1);
    assert.equal(catalog.agents.length, 2);
  });

  it("keeps a missing id in the address bar until the section changes", () => {
    const current = "?section=files&file=missing-file";
    const stay = shareWriteForView("files", { chat: null, project: null, file: null, bot: null });
    assert.equal(shareWriteDropsMissing(current, stay, catalog, sections), true);
    const leave = shareWriteForView("chat", { chat: "chat-1", project: null, file: null, bot: null });
    assert.equal(shareWriteDropsMissing(current, leave, catalog, sections), false);
    assert.equal(catalog.files.length, 1);
  });
});
