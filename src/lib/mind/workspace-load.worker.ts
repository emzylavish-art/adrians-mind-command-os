import { handleWorkspaceParse, type WorkspaceParseRequest, type WorkspaceParseResponse } from "./workspace-codec.ts";

const worker = globalThis as unknown as { onmessage: ((event: MessageEvent<WorkspaceParseRequest>) => void) | null; postMessage(response: WorkspaceParseResponse): void };
worker.onmessage = (event) => worker.postMessage(handleWorkspaceParse(event.data));
