import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oauthCallbackRedirect } from "./oauth-callback-response.ts";

describe("oauthCallbackRedirect", () => {
  it("returns a mutable 302 Location response (unlike Response.redirect)", () => {
    const res = oauthCallbackRedirect("https://adrians-mind.vercel.app/dashboard");
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("Location"), "https://adrians-mind.vercel.app/dashboard");
    // Prod bug: Response.redirect headers are immutable; Start merges Set-Cookie via delete/append.
    res.headers.delete("set-cookie");
    res.headers.append("set-cookie", "sb-test=1; Path=/; HttpOnly");
    assert.deepEqual(res.headers.getSetCookie(), ["sb-test=1; Path=/; HttpOnly"]);
  });

  it("documents that Response.redirect is immutable and cannot accept Set-Cookie merges", () => {
    const res = Response.redirect("https://adrians-mind.vercel.app/dashboard", 302);
    assert.throws(() => {
      res.headers.delete("set-cookie");
    }, /immutable/i);
  });
});
