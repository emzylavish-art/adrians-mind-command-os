import { EmbeddedWorkspacePage } from "@/components/mind/embedded-workspace-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  component: SocialSectionPage,
  validateSearch: (search: Record<string, unknown>) => ({ workspace: typeof search.workspace === "string" ? search.workspace : undefined }),
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Social" },
      {
        name: "description",
        content: "Adrian Social runs inside this software. The website is only a backup.",
      },
    ],
  }),
});

function SocialSectionPage() {
  return <EmbeddedWorkspacePage title="Adrian Social" src="/apps/social/index.html" workspace={Route.useSearch().workspace} />;
}
