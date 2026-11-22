import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/gpt-wrapper")({
  component: GptWrapperPage,
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
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <iframe
        title="GPT wrapper"
        src="/apps/gpt-wrapper/index.html"
        className="min-h-0 w-full flex-1 border-0 bg-bg"
      />
    </main>
  );
}
