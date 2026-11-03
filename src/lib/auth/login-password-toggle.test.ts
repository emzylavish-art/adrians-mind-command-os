import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { serverFnRedirectHref } from "./login-providers.ts";

const root = join(import.meta.dirname, "../..");

describe("login password show/hide toggle", () => {
  const login = readFileSync(join(root, "routes/login.tsx"), "utf8");

  it("renders an accessible eye toggle that preserves autocomplete", () => {
    assert.match(login, /data-testid="login-password-toggle"/);
    assert.match(login, /aria-label=\{showPassword \? "Hide password" : "Show password"\}/);
    assert.match(login, /autoComplete=\{\s*mode === "sign-in" \? "current-password" : "new-password"/);
    assert.match(login, /type=\{showPassword \? "text" : "password"\}/);
    assert.match(login, /type="button"/);
  });

  it("client follows serialized 307 redirect including ?next=", () => {
    assert.match(login, /serverFnRedirectHref\(result\)/);
    assert.match(login, /serverFnRedirectHref\(err\)/);
    assert.match(login, /window\.location\.assign\(redirectTo\)/);
    assert.equal(
      serverFnRedirectHref({
        href: "/dashboard?next=%2Ftools",
        statusCode: 307,
        isSerializedRedirect: true,
      }),
      "/dashboard?next=%2Ftools",
    );
    assert.equal(
      serverFnRedirectHref({
        error: { href: "/dashboard", statusCode: 307, isSerializedRedirect: true },
      }),
      "/dashboard",
    );
  });
});

describe("command-app MCP list failure banner gate", () => {
  it("gates mcp list reportFailure with shouldShowFailureBanner", () => {
    const command = readFileSync(join(root, "components/mind/command-app.tsx"), "utf8");
    assert.match(command, /shouldShowFailureBanner/);
    assert.match(command, /MCP_AUTH_REQUIRED_NOTICE/);
    assert.match(command, /mcp:registry/);
    assert.match(command, /Sign in to load MCP servers|MCP_AUTH_REQUIRED_NOTICE/);
  });
});
