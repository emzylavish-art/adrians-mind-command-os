import { createFileRoute } from "@tanstack/react-router";
import { CommandDeepLinkPage, loadCommandDeepLinkWorkspace } from "@/components/mind/command-deep-link";

export const Route = createFileRoute("/connectors")({
  loader: loadCommandDeepLinkWorkspace,
  component: DeepLink,
});

function DeepLink() {
  const { serverWorkspace } = Route.useLoaderData();
  return <CommandDeepLinkPage view="connected" serverWorkspace={serverWorkspace} />;
}
