import { createFileRoute } from "@tanstack/react-router";
import { CommandApp } from "@/components/mind/command-app";
import { loadMindCopy } from "@/lib/mind/server";
import type { Workspace } from "@/lib/mind/types";

export const Route = createFileRoute("/bots")({
  loader: async (): Promise<{ serverWorkspace: Workspace | null }> => {
    try {
      const result = await loadMindCopy();
      if (result.ok && result.workspace) {
        return { serverWorkspace: result.workspace as Workspace };
      }
    } catch {
      /* signed-out or server unavailable — paint from local cache */
    }
    return { serverWorkspace: null };
  },
  component: BotsPage,
});

function BotsPage() {
  const { serverWorkspace } = Route.useLoaderData();
  return <CommandApp serverWorkspace={serverWorkspace} />;
}
