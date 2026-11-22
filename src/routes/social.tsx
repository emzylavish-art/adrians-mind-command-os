import { createFileRoute } from "@tanstack/react-router";

const SOCIAL_PANEL = "https://adrian-social.pages.dev";
const SOCIAL_REPO = "https://github.com/emzylavish-art/adrian-social";
const SOCIAL_HANDOFF = "https://app.notion.com/p/4201aa27632381c2a020e1977152298c";
const MERGE_HANDOFF = "https://app.notion.com/p/4201aa276323812f8923ec1f7d69453e";

export const Route = createFileRoute("/social")({
  component: SocialSectionPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Social" },
      {
        name: "description",
        content: "Opens the Adrian Social panel and keeps the PC software as a separate local service.",
      },
    ],
  }),
});

function SocialSectionPage() {
  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/brand/marks/plugins.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
          <div>
            <h1 className="text-3xl font-bold">Social</h1>
            <p className="text-sm text-muted">
              Portable PC software. Not connected is correct until the local service answers.
            </p>
          </div>
        </div>

        <section className="space-y-4 rounded-panel border border-line bg-surface p-5">
          <p className="text-sm text-muted">
            The panel opens in a new tab. The PC software stays loopback-only on 127.0.0.1:8765, approval-gated, and
            unable to send by itself. A line is marked sent only after the saved session shows that line.
          </p>
          <a
            href={SOCIAL_PANEL}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-12 w-full items-center justify-center rounded-panel bg-fg px-4 text-sm font-medium text-bg"
          >
            Open social panel
          </a>
          <div className="space-y-2 text-sm">
            <a className="block underline" href={SOCIAL_PANEL} target="_blank" rel="noreferrer">
              {SOCIAL_PANEL}
            </a>
            <a className="block underline" href={SOCIAL_REPO} target="_blank" rel="noreferrer">
              {SOCIAL_REPO}
            </a>
            <a className="block underline" href={SOCIAL_HANDOFF} target="_blank" rel="noreferrer">
              Social handoff
            </a>
            <a className="block underline" href={MERGE_HANDOFF} target="_blank" rel="noreferrer">
              Merge handoff
            </a>
          </div>
          <p className="text-xs text-muted">
            One signer only: scripts/local-trust.ps1 on the owner PC. Do not invent a publisher certificate. Do not
            open port 9222. Do not download Jeff weights. Do not copy secrets into this OS repo.
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
