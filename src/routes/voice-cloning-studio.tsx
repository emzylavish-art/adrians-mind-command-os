import { createFileRoute } from "@tanstack/react-router";
import { VoiceCloningStudioPage } from "@/components/mind/voice-cloning-studio/voice-cloning-studio";

export const Route = createFileRoute("/voice-cloning-studio")({
  component: VoiceCloningStudioRoute,
});

function VoiceCloningStudioRoute() {
  return <VoiceCloningStudioPage />;
}
