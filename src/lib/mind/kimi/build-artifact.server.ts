import { createHash } from "node:crypto";
import { buildArtifactName, BUILD_ARTIFACT_LIMIT, readBuildArtifactStatus, type StoredBuildArtifact } from "./build-artifact.ts";

export function buildArtifactBytes(artifact: unknown): Buffer | null {
  const metadata = readBuildArtifactStatus(artifact);
  const base64 = (artifact as Partial<StoredBuildArtifact> | null)?.base64;
  if (metadata?.status !== "saved" || typeof base64 !== "string" || base64.length > Math.ceil(BUILD_ARTIFACT_LIMIT / 3) * 4) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== metadata.bytes || bytes.toString("base64") !== base64 ||
    createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) return null;
  return bytes;
}

export function completionBuildArtifact(expected: unknown, reported: unknown): StoredBuildArtifact | undefined {
  if (!buildArtifactName(expected)) return;
  const metadata = readBuildArtifactStatus(reported);
  const bytes = metadata?.name === expected ? buildArtifactBytes(reported) : null;
  if (!bytes || metadata?.status !== "saved") return { name: expected, status: "unavailable" };
  return { ...metadata, base64: bytes.toString("base64") };
}
