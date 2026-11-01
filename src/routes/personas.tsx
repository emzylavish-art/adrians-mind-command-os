import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/personas")({
  beforeLoad: () => {
    throw redirect({ to: "/explore" });
  },
});
