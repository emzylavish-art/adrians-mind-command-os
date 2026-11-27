export type VideoProgressScope = { ownerId: string | null; session: string; chatId: string; operationId: string };
export type VideoProgress = VideoProgressScope & { stage: "submitting" | "recovering" | "accepted" | "retrying" | "ready"; requestId: string | null };

export function createVideoProgress(scope: VideoProgressScope, recovering = false): VideoProgress {
  return { ...scope, stage: recovering ? "recovering" : "submitting", requestId: null };
}

/** Accepted/rendering wording always requires a returned or saved provider handle. */
export function advanceVideoProgress(progress: VideoProgress, stage: "accepted" | "retrying" | "ready", acceptedRequestId?: string): VideoProgress {
  const requestId = acceptedRequestId?.trim() || progress.requestId;
  if (!requestId) throw new Error("A provider acceptance handle is required before reporting video progress.");
  return { ...progress, stage, requestId };
}

export function videoProgressMessage(progress: VideoProgress | null, current: { ownerId: string | null; session: string; chatId: string | null | undefined }): string | null {
  if (!progress || progress.ownerId !== current.ownerId || progress.session !== current.session || progress.chatId !== current.chatId) return null;
  switch (progress.stage) {
    case "submitting": return "Submitting the video request…";
    case "recovering": return "Checking the saved video request…";
    case "accepted": return "Video accepted. Rendering is in progress.";
    case "retrying": return "Status check interrupted. Retrying the saved video status without starting another generation.";
    case "ready": return "Video is ready.";
  }
}
