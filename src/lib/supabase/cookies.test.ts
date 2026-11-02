import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProductionRuntime,
  mergeCookieOptions,
  requiredAuthCookieShape,
  sessionCookieOptions,
} from "./cookies.ts";

describe("sessionCookieOptions", () => {
  it("is httpOnly + SameSite=Lax; Secure only in prod", () => {
    assert.deepEqual(requiredAuthCookieShape(false), {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
    assert.deepEqual(requiredAuthCookieShape(true), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    assert.equal(sessionCookieOptions(true).path, "/");
  });
});

describe("isProductionRuntime", () => {
  it("treats NODE_ENV=production or VERCEL=1 as prod", () => {
    assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
    assert.equal(isProductionRuntime({ VERCEL: "1" }), true);
    assert.equal(isProductionRuntime({ NODE_ENV: "development" }), false);
  });
});

describe("mergeCookieOptions", () => {
  it("forces httpOnly and SameSite=Lax", () => {
    const merged = mergeCookieOptions(
      { httpOnly: false, sameSite: "none", secure: false, path: "/auth" },
      false,
    );
    assert.equal(merged.httpOnly, true);
    assert.equal(merged.sameSite, "lax");
    assert.equal(merged.path, "/auth");
    assert.equal(merged.secure, false);
  });

  it("turns Secure on in production even if incoming omits it", () => {
    const merged = mergeCookieOptions({ path: "/" }, true);
    assert.equal(merged.secure, true);
    assert.equal(merged.httpOnly, true);
  });
});

describe("isProductionRuntime insecure cookie escape", () => {
  it("treats MIND_ALLOW_INSECURE_COOKIES=1 as non-prod so local HTTP can store auth cookies", () => {
    assert.equal(
      isProductionRuntime({
        NODE_ENV: "production",
        VERCEL: "1",
        MIND_ALLOW_INSECURE_COOKIES: "1",
      }),
      false,
    );
  });
});
