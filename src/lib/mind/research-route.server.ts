import { createHash } from "node:crypto";
import type { ResearchProviderIdentity } from "./research.ts";

/** An opaque identity binds retries to the route and credential generation.
 * Never return the endpoint, credential or provider URL query parameters. */
export function researchRouteIdentity(input: {
  provider: "configured-search" | "xai";
  endpoint: string;
  key: string;
  strategy: "multi_query" | "single_query";
  model?: string;
}): ResearchProviderIdentity {
  return {
    id: input.provider,
    label: input.provider === "xai" ? "xAI web search" : "Configured search service",
    strategy: input.strategy,
    routeFingerprint: createHash("sha256").update(JSON.stringify([input.provider, input.endpoint, input.key, input.model ?? ""])).digest("hex"),
    ...(input.model ? { model: input.model } : {}),
  };
}
