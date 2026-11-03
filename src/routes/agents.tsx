import { createFileRoute, redirect } from "@tanstack/react-router";

/** Alias deep link — same shell as /bots. */
export const Route = createFileRoute("/agents")({
  beforeLoad: () => {
    throw redirect({ to: "/bots" });
  },
});
