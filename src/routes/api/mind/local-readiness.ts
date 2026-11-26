import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { nativeBuildIdentity } from "virtual:adrian-native-build-identity";
import contract from "../../../../desktop/runtime-contract.cjs";

export const Route = createFileRoute("/api/mind/local-readiness")({
  server: { handlers: { GET: async ({ request }) => {
    const env = process.env;
    const challenge = request.headers.get("x-adrian-runtime-challenge") || "";
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
    if (!local || env.VERCEL || env.ADRIAN_PC !== "1" || !env.ADRIAN_RUNTIME_SECRET || !/^[a-f0-9]{48}$/.test(challenge)) return new Response("Not found", { status: 404 });
    let storage = false;
    try { const sql = await getSql(); await sql`select 1 from mind_snapshot limit 0`; storage = true; } catch { /* No snapshot rows or private storage diagnostics leave this probe. */ }
    const receipt = contract.readinessReceipt({ ...nativeBuildIdentity, deviceId: env.ADRIAN_DEVICE_ID || "" }, challenge, env.ADRIAN_RUNTIME_SECRET, storage);
    return Response.json(receipt, { status: storage ? 200 : 503, headers: { "cache-control": "no-store" } });
  } } },
});
