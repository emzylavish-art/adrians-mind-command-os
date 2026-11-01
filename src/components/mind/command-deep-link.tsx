import { CommandApp } from "@/components/mind/command-app";
import type { CommandDeepLinkView } from "@/lib/mind/deep-link-views";
import { loadMindCopy } from "@/lib/mind/server";
import type { Workspace } from "@/lib/mind/types";

export async function loadCommandDeepLinkWorkspace(): Promise<{ serverWorkspace: Workspace | null }> {
  try {
    const result = await loadMindCopy();
    if (result.ok && result.workspace) {
      return { serverWorkspace: result.workspace as Workspace };
    }
  } catch {
    /* signed-out */
  }
  return { serverWorkspace: null };
}

export function CommandDeepLinkPage({
  view,
  serverWorkspace,
}: {
  view: CommandDeepLinkView;
  serverWorkspace: Workspace | null;
}) {
  return <CommandApp serverWorkspace={serverWorkspace} initialView={view} />;
}
