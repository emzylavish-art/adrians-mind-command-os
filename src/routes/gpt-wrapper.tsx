import { EmbeddedWorkspacePage } from "@/components/mind/embedded-workspace-page";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/gpt-wrapper")({
  component: GptWrapperPage,
  validateSearch: (search: Record<string, unknown>) => ({ workspace: typeof search.workspace === "string" ? search.workspace : undefined }),
  head: () => ({
    meta: [
      { title: "Adrian's Mind · GPT wrapper" },
      {
        name: "description",
        content: "The GPT wrapper runs inside this software. The website is only a backup.",
      },
    ],
  }),
});

function GptWrapperPage() {
  return <EmbeddedWorkspacePage title="GPT wrapper" src="/apps/gpt-wrapper/index.html" workspace={Route.useSearch().workspace} />;
}
