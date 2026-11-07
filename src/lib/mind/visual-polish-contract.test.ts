import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const app = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");

describe("visual polish contract", () => {
  it("gives both composers a single scrollable toolbar and a pinned send control", () => {
    assert.equal((app.match(/composer-toolbar/g) ?? []).length, 2);
    assert.equal((app.match(/composer-send/g) ?? []).length, 2);
    assert.match(css, /Visual polish lane[\s\S]*\.composer-toolbar \{[\s\S]*flex-wrap:\s*nowrap/);
    assert.match(css, /Visual polish lane[\s\S]*\.composer-send \{[\s\S]*position:\s*sticky/);
  });

  it("names the command and chat fields and shows loading versus empty workspace panels", () => {
    assert.match(app, /aria-label="Command"/);
    assert.match(app, /aria-label="Message"/);
    assert.match(app, /data-testid="projects-loading"/);
    assert.match(app, /data-testid="projects-empty"/);
    assert.match(app, /data-testid="activity-loading"/);
    assert.match(app, /data-testid="activity-empty"/);
    assert.match(css, /\.workspace-loading/);
    assert.match(css, /\.suggestion-chip[\s\S]*min-height:\s*2\.75rem/);
  });

  it("keeps search results keyboard-addressable without adding a send shortcut", () => {
    assert.match(app, /onPaletteKeyDown/);
    assert.match(app, /role="listbox"/);
    assert.match(app, /palette-option-active/);
    assert.equal(app.includes("onKeyDown") && app.includes("sendCommand()"), true);
    assert.doesNotMatch(app, /paletteKeyAction\([\s\S]{0,200}sendCommand/);
  });

  it("uses 44px targets on the sign-in mode tabs and dismiss control", () => {
    assert.doesNotMatch(login, /min-h-10/);
    assert.doesNotMatch(login, /min-h-9/);
    assert.match(login, /min-h-11 rounded-\[calc\(var\(--radius-panel\)-0\.15rem\)\] bg-fg/);
    assert.match(login, /Dismiss/);
  });
});
