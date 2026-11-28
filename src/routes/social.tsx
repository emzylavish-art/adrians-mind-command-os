import { useCurrentUser } from "@/lib/auth/use-current-user";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  component: SocialSectionPage,
  head: () => ({
    meta: [
      { title: "Adrian's Mind · Social" },
      {
        name: "description",
        content: "Adrian Social workspace. A phone cannot reach the EliteBook service at 127.0.0.1.",
      },
    ],
  }),
});

function SocialSectionPage() {
  const user = useCurrentUser();
  const signedIn = Boolean(user?.id);
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2 text-sm">
        <a href="/" className="inline-flex min-h-11 items-center underline">
          Back to Mind
        </a>
        <p className="max-w-3xl text-muted">
          {signedIn ? "Signed in." : "Signed out."} No paired Social host is available to this browser.
          A phone cannot reach 127.0.0.1:8765. Live platform connections are unverified.
        </p>
      </div>
      <iframe
        key={user?.id ?? "signed-out"}
        title="Adrian Social"
        src="/apps/social/index.html"
        className="min-h-0 w-full flex-1 border-0 bg-bg"
      />
    </main>
  );
}
