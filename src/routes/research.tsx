import { createFileRoute } from "@tanstack/react-router";

const RESEARCH_SITE = "https://tikref-h96wuqtt.manus.space/";
const RESEARCH_REPO = "https://github.com/emzylavish-art/adrian-research";
const RESEARCH_PR = "https://github.com/emzylavish-art/adrian-research/pull/4";

export const Route = createFileRoute("/research")({
  component: ResearchSectionPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Research" },
      {
        name: "description",
        content: "Opens the Adrian Research free-first tool reference and source links.",
      },
    ],
  }),
});

function ResearchSectionPage() {
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/brand/marks/explore.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
          <div>
            <h1 className="text-3xl font-bold">Research</h1>
            <p className="text-sm text-muted">
              Free-first social research tools. Missing values stay null. No invented counts.
            </p>
          </div>
        </div>

        <section className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <p className="text-sm text-muted">
            This section opens the existing research website. It does not copy secrets and it does not claim a live
            paid key path.
          </p>
          <a
            href={RESEARCH_SITE}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 w-full items-center justify-center rounded-panel bg-fg px-4 text-sm font-medium text-bg"
          >
            Open research website
          </a>
          <div className="space-y-2 text-sm">
            <a className="block underline" href={RESEARCH_SITE} target="_blank" rel="noreferrer">
              {RESEARCH_SITE}
            </a>
            <a className="block underline" href={RESEARCH_REPO} target="_blank" rel="noreferrer">
              {RESEARCH_REPO}
            </a>
            <a className="block underline" href={RESEARCH_PR} target="_blank" rel="noreferrer">
              {RESEARCH_PR}
            </a>
          </div>
          <p className="text-xs text-muted">
            Local MCP, if needed on the same PC as Adrian Social, must use port 8766. Adrian Social keeps 8765.
          </p>
        </section>

        <div className="mt-6">
          <a href="/" className="inline-flex min-h-11 items-center justify-center rounded-panel border border-line px-4 text-sm">
            Back to Chat
          </a>
        </div>
      </div>
    </main>
  );
}
