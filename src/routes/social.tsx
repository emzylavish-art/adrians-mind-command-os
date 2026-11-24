import { useCurrentUser } from "@/lib/auth/use-current-user";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  component: SocialSectionPage,
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
  const user = useCurrentUser();
  return (
    <main className="flex h-dvh min-h-0 flex-col bg-bg text-fg">
      <iframe
        key={user?.id ?? "signed-out"}
        title="Adrian Social"
        src="/apps/social/index.html"
        className="min-h-0 w-full flex-1 border-0 bg-bg"
      />
    </main>
  );
}
