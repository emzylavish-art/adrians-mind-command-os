import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";

const root = join(process.cwd(), "skills");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function slug(title: string) {
  const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return clean || "from-chat";
}

function listSkills() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && statSync(join(root, entry.name, "SKILL.md"), { throwIfNoEntry: false })?.isFile())
    .map((entry) => entry.name)
    .sort();
}

export const Route = createFileRoute("/api/mind/skills")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
        try { await requireUserId(bearer); }
        catch { return json({ ok: false, error: "Sign in is required." }, 401); }
        try { return json({ ok: true, skills: listSkills() }); }
        catch { return json({ ok: false, error: "Skill directory could not be read." }, 503); }
      },
      POST: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        try { await requireUserId(); }
        catch { return json({ ok: false, error: "Sign in is required." }, 401); }
        const result = await readJsonObjectBody(request, 32_000);
        if (!result.ok) return json({ ok: false, error: result.error }, result.status);
        const { title: rawTitle, body: rawSource } = result.body;
        const title = typeof rawTitle === "string" ? rawTitle.replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "From chat";
        const source = typeof rawSource === "string" ? rawSource.trim() : "";
        if (!source || source.length > 8000) {
          return json({ ok: false, error: "Provide proposal text of 1 to 8,000 characters." }, 400);
        }
        if (/private key|BEGIN [A-Z ]*PRIVATE|sk-live|xai-|api[_-]?key\s*[:=]/i.test(title + "\n" + source)) {
          return json({ ok: false, error: "Remove credentials before preparing a skill proposal." }, 400);
        }
        const name = slug(title);
        const markdown = [
          "---",
          `name: ${name}`,
          "description: Proposed from chat. Review the scope and behavior before installation.",
          "---",
          "",
          `# ${title || "From chat"}`,
          "",
          source,
          "",
        ].join("\n");
        return json({
          ok: true,
          name,
          markdown,
          note: "Skill proposal prepared for review.",
        });
      },
    },
  },
});
