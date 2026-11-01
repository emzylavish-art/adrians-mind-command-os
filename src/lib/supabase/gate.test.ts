import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideDashboardGate } from "./gate.ts";

describe("decideDashboardGate", () => {
  it("fails closed when env is missing", () => {
    assert.deepEqual(
      decideDashboardGate({ configured: false, user: null }),
      { action: "redirect_login", reason: "missing_env" },
    );
    assert.deepEqual(
      decideDashboardGate({
        configured: false,
        user: { id: "u1", email: "a@b.c" },
      }),
      { action: "redirect_login", reason: "missing_env" },
    );
  });

  it("redirects when configured but no user", () => {
    assert.deepEqual(
      decideDashboardGate({ configured: true, user: null }),
      { action: "redirect_login", reason: "no_user" },
    );
    assert.deepEqual(
      decideDashboardGate({
        configured: true,
        user: { id: "", email: null },
      }),
      { action: "redirect_login", reason: "no_user" },
    );
  });

  it("allows a valid user when configured", () => {
    assert.deepEqual(
      decideDashboardGate({
        configured: true,
        user: { id: "user-1", email: "owner@example.com" },
      }),
      {
        action: "allow",
        user: { id: "user-1", email: "owner@example.com" },
      },
    );
  });
});
