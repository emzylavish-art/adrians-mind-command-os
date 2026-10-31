import { createFileRoute } from "@tanstack/react-router";
import { CommandApp } from "@/components/mind/command-app";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <CommandApp />;
}
