import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { emptyFleet } from "./fleet.ts";
import { emptyWorkspace } from "./workspace.ts";
import {
  buildPersonaDirectory,
  filterPersonaDirectory,
  emptyStateForCategory,
} from "./personas/directory.ts";
import { selectPersona, personaChatHref, PERSONA_SELECT_KEY } from "./personas/selection.ts";
import { PERSONA_CATEGORIES } from "./personas/categories.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const exploreRoute = readFileSync(join(root, "src/routes/explore.tsx"), "utf8");
const personasRoute = readFileSync(join(root, "src/routes/personas.tsx"), "utf8");
const directoryUi = readFileSync(join(root, "src/components/mind/persona-directory.tsx"), "utf8");
const routeTree = readFileSync(join(root, "src/routeTree.gen.ts"), "utf8");
const commandApp = readFileSync(join(root, "src/components/mind/command-app.tsx"), "utf8");
const research = existsSync(join(root, "src/lib/mind/research.ts"))
  ? readFileSync(join(root, "src/lib/mind/research.ts"), "utf8")
  : "";

describe("integration persona directory survives merge", () => {
  it("keeps /explore + /personas routes and generated route tree entries", () => {
    assert.match(exploreRoute, /createFileRoute\("\/explore"\)/);
    assert.match(exploreRoute, /PersonaDirectoryView/);
    assert.match(personasRoute, /explore|PersonaDirectoryView|createFileRoute/);
    assert.match(routeTree, /\/explore/);
    assert.match(routeTree, /Explore/i);
  });

  it("keeps persona-directory UI testids and selectPersona wiring", () => {
    for (const needle of [
      'data-testid="persona-directory"',
      'data-testid="persona-search"',
      'data-testid="persona-grid"',
      'data-testid="persona-empty"',
      "selectPersona",
      "emitFailure",
      "mountFailure",
      "persona_open",
      "buildPersonaDirectory",
      "filterPersonaDirectory",
      "PersonaDirectoryView",
    ]) {
      assert.match(directoryUi, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const actionSrc = readFileSync(join(root, "src/lib/mind/persona-select-action.ts"), "utf8");
    assert.match(actionSrc, /selectPersona/);
    assert.match(actionSrc, /onceRetry/);
  });

  it("persists the persona synchronously and has no delayed Explore writer", () => {
    assert.match(directoryUi, /persistPersonaOpen\(window\.localStorage, result\.ws, result\.selection\)/);
    assert.match(directoryUi, /if \(!persisted\.ok\)/);
    assert.match(directoryUi, /Nothing was opened/);
    assert.match(directoryUi, /opens Chat with that agent's saved instructions/);
    assert.doesNotMatch(exploreRoute, /localStorage\.setItem|window\.setTimeout/);
  });

  it("builds a directory from templates and selects into agent chat href", () => {
    const directory = buildPersonaDirectory(emptyFleet());
    assert.ok(directory.cards.length >= 8);
    assert.ok(PERSONA_CATEGORIES.length >= 4);
    const card = directory.cards.find((item) => item.source === "template")!;
    assert.ok(card);
    const href = personaChatHref(card.agentId || card.id);
    assert.match(href, /view=chat/);
    assert.match(href, /mode=agent/);
    const result = selectPersona(emptyWorkspace(), card, "2026-11-01T14:00:00.000+01:00");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.match(result.href, /view=chat/);
      assert.equal(result.selection.mode, "agent");
    }
    assert.equal(PERSONA_SELECT_KEY.startsWith("amcos.persona"), true);
    const videoEmpty = emptyStateForCategory("video", 0);
    assert.match(videoEmpty ?? "", /No local personas in Video/i);
    const search = filterPersonaDirectory(directory, { category: "search" });
    assert.ok(search.length >= 1);
  });

  it("does not drop sibling lane markers in command-app while adding explore", () => {
    for (const needle of [
      'header-voice-mode',
      'data-testid="failure-banner"',
      'data-testid="executing-tools"',
      "ModelTierChip",
      "onImagine",
      "mcpToolFailure",
      "ServiceBoard",
    ]) {
      assert.match(commandApp, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("integration search timeout merge status", () => {
  it("asserts search timeout markers survived after d507e30+6bb0b7b landed", () => {
    const present =
      /export const SEARCH_TIMEOUT_REPLY/.test(research) &&
      /MIND_SEARCH_TIMEOUT_MS/.test(research) &&
      /MIND_SEARCH_DEEP_TIMEOUT/.test(research);
    assert.equal(present, true);
    assert.match(research, /boundAbortSignal/);
    assert.match(research, /Search timed out\. No citations were created\./);
  });
});
