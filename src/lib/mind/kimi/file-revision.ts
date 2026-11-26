import { createHash } from "node:crypto";

export function fileRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
export function reviewedFileMatches(content: string, expected: { expectedRevision?: unknown; expectedContent?: unknown }): boolean {
  if (typeof expected.expectedRevision === "string") return expected.expectedRevision === fileRevision(content);
  return typeof expected.expectedContent === "string" && expected.expectedContent === content;
}
