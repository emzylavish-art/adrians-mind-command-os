import { embeddedWorkspaceSearch } from "@/lib/mind/app-location";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  validateSearch: (search: Record<string, unknown>) => ({ workspace: typeof search.workspace === "string" ? search.workspace : undefined }),
  beforeLoad: ({ search }) => {
    const params = new URLSearchParams({ section: "social" });
    const returnSearch = embeddedWorkspaceSearch(search.workspace ?? "");
    if (returnSearch) params.set("socialReturn", returnSearch);
    throw redirect({ href: "/?" + params });
  },
});
