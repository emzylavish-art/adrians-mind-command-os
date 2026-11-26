import { analyzeImage, IMAGE_ANALYSIS_MODEL, validateImageAnalysis, type ImageAnalysisInput } from "./image-analyze.ts";
import { rpcDispatchContext, rpcOperationId, runOwnerProviderRequest, type ProviderRequestDependencies } from "./rpc-provider-request.server.ts";

type ImageRequest = Omit<ImageAnalysisInput, "visionKey"> & { operationId?: string; taskId?: string; projectId?: string | null; freeOnly?: boolean };
type Dependencies = { visionKey: string | undefined; isHalted: (ownerId: string) => Promise<boolean>; fetch: typeof globalThis.fetch; dispatch?: ProviderRequestDependencies };
const notSent = (error: string) => ({ ok: false as const, analyzed: false, provider: null, text: "", error, dispatched: false as const });

/** The older image-inspection RPC shares owner budgets with the main image/chat routes. */
export async function runOwnerImageAnalysis(ownerId: string, request: ImageRequest, deps: Dependencies) {
  const operationId = rpcOperationId(request.operationId, "image-analysis");
  if (request.freeOnly === true) return { ...notSent("Free-only mode prevents this separately billed vision request."), operationId };
  if (await deps.isHalted(ownerId)) return { ...notSent("Emergency stop is on. No image was sent."), operationId };
  const input = { name: request.name, bytes: request.bytes, imageBase64: request.imageBase64, visionKey: deps.visionKey };
  const prepared = validateImageAnalysis(input);
  if (!prepared.ok) return { ...prepared, operationId, dispatched: false as const };
  const dispatch = rpcDispatchContext({ operationId, taskId: request.taskId || operationId, projectId: request.projectId, provider: "openai", model: IMAGE_ANALYSIS_MODEL, textOnly: false }, { name: request.name, bytes: request.bytes, imageBase64: request.imageBase64 });
  const result = await runOwnerProviderRequest(ownerId, dispatch, async () => {
    if (await deps.isHalted(ownerId)) return { ...notSent("Emergency stop changed before image dispatch. No image was sent."), retryable: false as const };
    return analyzeImage({ ...input, fetch: deps.fetch });
  }, deps.dispatch);
  return { analyzed: false, provider: null, text: "", ...result };
}
