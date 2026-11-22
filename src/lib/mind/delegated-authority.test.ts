import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { delegateGrant, IDENTITY_NETWORK, issueGrant, revokeGrant, useGrant } from "./delegated-authority.ts";

const now = 1_000;

describe("delegated authority", () => {
  it("lets a narrower child act until expiry and not after revocation", () => {
    const parent = issueGrant({ id: "owner", holder: "adrian", scopes: ["files"], expiresAt: 2_000, canDelegate: true });
    const child = delegateGrant(parent, { id: "bot", holder: "bot", scopes: ["files"], expiresAt: 1_500, canDelegate: true }, now);
    assert.equal(child.canDelegate, false);
    assert.equal(useGrant(child, "files", 1_200).ok, true);
    assert.equal(useGrant(child, "files", 1_500).reason, "expired");
    revokeGrant(child);
    assert.equal(useGrant(child, "files", 1_200).reason, "revoked");
    assert.equal(IDENTITY_NETWORK, "not connected");
  });

  it("refuses a wider grant and a self-grant", () => {
    const parent = issueGrant({ id: "owner", holder: "adrian", scopes: ["files"], expiresAt: 2_000, canDelegate: true });
    assert.throws(() => delegateGrant(parent, { id: "bot", holder: "bot", scopes: ["files", "money"], expiresAt: 1_500, canDelegate: false }, now));
    assert.throws(() => delegateGrant(parent, { id: "self", holder: "adrian", scopes: ["files"], expiresAt: 1_500, canDelegate: false }, now));
  });
});
