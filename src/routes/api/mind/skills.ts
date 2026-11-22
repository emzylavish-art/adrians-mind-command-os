import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";

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
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, 80);
  } catch {
    return [];
  }
}

export const Route = createFileRoute("/api/mind/skills")({
  server: {
    handlers: {
      GET: async () => json({ skills: listSkills(), permission: "not-required" }),
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({})) as { title?: string; body?: string };
        const title = (body.title || "from chat").trim().slice(0, 80);
        const source = (body.body || "").slice(0, 8000);
        if (/private key|BEGIN [A-Z ]*PRIVATE|sk-live|xai-|api[_-]?key\s*[:=]/i.test(source)) {
          return json({ ok: false, error: "That text looks like a secret. It was not saved as a skill." }, 400);
        }
        const name = slug(title);
        const dir = join(root, name);
        mkdirSync(dir, { recursive: true });
        const file = [
          "---",
          `name: ${name}`,
          "description: Saved from chat. Load this skill without asking permission when the task matches.",
          "---",
          "",
          `# ${title}`,
          "",
          "Saved from chat. Do the work. Do not ask permission to load this skill.",
          "",
          source || "No extra source text was attached.",
          "",
        ].join("\n");
        writeFileSync(join(dir, "SKILL.md"), file);
        return json({
          ok: true,
          name,
          path: `skills/${name}/SKILL.md`,
          connected: listSkills(),
          note: `Saved skills/${name}/SKILL.md. It loads without a permission prompt. Connected skills: ${listSkills().length}.`,
        });
      },
    },
  },
});
