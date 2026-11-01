import { createFileRoute } from "@tanstack/react-router";
import { handleBuiltinMcpHttp } from "@/lib/mind/mcp/builtin-server";

async function handle({ request }: { request: Request }) {
  return handleBuiltinMcpHttp(request);
}

export const Route = createFileRoute("/api/mind/mcp/builtin")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      DELETE: handle,
    },
  },
});
