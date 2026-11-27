import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { assertSameOrigin } from "@/lib/mind/connectors/oauth-csrf";
import { readJsonObjectBody } from "@/lib/mind/request-body";

import { listInstructionMetadata, readInstructionPreferences, saveInstructionPreferences, instructionHistory } from "@/lib/mind/skill-instructions.server";

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


export const Route = createFileRoute("/api/mind/skills")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const bearer = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
        let owner: string;
        try { owner = await requireUserId(bearer); }
        catch { return json({ ok: false, error: "Sign in is required." }, 401); }
        try {
          const catalog = await listInstructionMetadata();
          return json({ ok: true, skills: catalog.map((entry) => entry.id), catalog, ...await readInstructionPreferences(owner), history: await instructionHistory(owner) });
        } catch { return json({ ok: false, error: "Skill catalog or assignment storage could not be read. No instructions were enabled." }, 503); }
      },
      PUT: async ({ request }) => {
        const origin = assertSameOrigin(request);
        if (!origin.ok) return json({ ok: false, error: origin.error }, 403);
        let owner: string;
        try { owner = await requireUserId(request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]); }
        catch { return json({ ok: false, error: "Sign in is required." }, 401); }
        const body = await readJsonObjectBody(request, 100_000);
        if (!body.ok) return json({ ok: false, error: body.error }, body.status);
        try { return json({ ok: true, ...await saveInstructionPreferences(owner, body.body.preferences, body.body.expectedRevision as number, await listInstructionMetadata()) }); }
        catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Instruction assignment could not be saved." }, 409); }
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
