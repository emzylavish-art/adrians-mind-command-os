import type { Workspace } from "./types.ts";

/** A workspace archive is not a whole-account backup. Inventory its actual portable contents. */
export function workspaceArchiveManifest(workspace: Workspace, options: { omittedTemporaryChats?: number } = {}) {
  const images = workspace.chats.flatMap((chat) => chat.messages.flatMap((message) => message.images ?? []));
  const blobReferences = images.filter((image) => image.blobId && !image.dataUrl).length;
  const externalVideoLinks = workspace.chats.reduce((sum, chat) => sum + chat.messages.filter((message) => Boolean(message.videoUrl)).length, 0);
  return {
    format: 1 as const,
    scope: "workspace-data" as const,
    integrity: "sha256-content-checksum" as const,
    authenticity: "not-established" as const,
    collections: {
      chats: workspace.chats.length,
      messages: workspace.chats.reduce((sum, chat) => sum + chat.messages.length, 0),
      memories: workspace.memories.length,
      memoryVersions: workspace.memories.reduce((sum, memory) => sum + memory.versions.length, 0),
      projects: workspace.projects.length,
      files: workspace.files.length,
      deletedMemoryIds: workspace.deletedMemoryIds?.length ?? 0,
      deletedFileIds: workspace.deletedFileIds?.length ?? 0,
      agents: workspace.agents.length,
      runs: workspace.runs.length,
      runEvents: workspace.runEvents.length,
      schedules: workspace.schedules.length,
      deployments: workspace.deployments.length,
      connectionLabels: workspace.connections.length,
      mailboxLabels: workspace.mailboxes.length,
      browserSessionRecords: workspace.browserSessions.length,
      pins: workspace.pins.length,
      usage: workspace.usage.length,
      audit: workspace.audit.length,
      recoveryRecords: workspace.recovery?.length ?? 0,
    },
    media: {
      inlineImages: images.filter((image) => Boolean(image.dataUrl)).length,
      blobReferencesWithoutBytes: blobReferences,
      externalVideoLinks,
      fullyPortable: blobReferences === 0 && externalVideoLinks === 0,
    },
    excluded: [
      "API keys, OAuth credentials, live account grants and server-only operation receipts",
      "Browser preferences stored outside the workspace, including voice and provider choices",
      "Image bytes stored only in this browser's blob store",
      "External video content behind saved links",
      ...(options.omittedTemporaryChats ? [`${options.omittedTemporaryChats} temporary conversations excluded by the selected export option`] : []),
    ],
    restorePolicy: "Imported schedules require explicit enabling. Imported unfinished runs are paused and old execution approvals do not authorize new dispatch.",
  };
}
