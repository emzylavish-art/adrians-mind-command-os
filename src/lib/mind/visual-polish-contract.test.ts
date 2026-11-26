import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const shell = readFileSync(new URL("../../components/mind/command-app.tsx", import.meta.url), "utf8");
const chatPane = readFileSync(new URL("../../components/mind/chat-pane.tsx", import.meta.url), "utf8");
const app = [shell, chatPane].join("\n");
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../components/mind/workspace-layout.css", import.meta.url), "utf8");
const login = readFileSync(new URL("../../routes/login.tsx", import.meta.url), "utf8");

describe("visual polish contract", () => {
  it("keeps one toolbar and send control in each composer, with compact layout rules", () => {
    const forms = app.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    for (const name of ["Command", "Message"]) {
      const composers = forms.filter((form) => form.includes(`aria-label="${name}"`));
      assert.equal(composers.length, 1, name);
      const [composer] = composers;
      assert.equal((composer.match(/className="composer-toolbar\b/g) ?? []).length, 1, name);
      assert.equal((composer.match(/className="composer-send\b/g) ?? []).length, 1, name);
    }
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

  it("preserves the independently scrollable draft and responsive navigation guards verified by the browser matrix", () => {
    assert.match(layout, /form\.thread-composer\s*>\s*\.thread-draft\s*\{[^}]*overflow-y:\s*auto/);
    assert.match(layout, /form\.thread-composer\s*>\s*\.composer-toolbar\s*\{[^}]*flex:\s*0 0 auto/);
    assert.match(layout, /@media\s*\(min-width:\s*768px\)\s*\{[^}]*button\[aria-label="Open menu"\]\s*\{[^}]*display:\s*none\s*!important/);
    assert.match(layout, /\.rail nav \.nav-item\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/);
    assert.ok(chatPane.indexOf('<ConversationComparison') > chatPane.indexOf('<details id="thread-chat-settings"'), "Comparison belongs in settings, leaving the transcript's ordinary layout bounded.");
  });
});
