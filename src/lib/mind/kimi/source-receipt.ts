export type BuildSourceReceipt = {
  workspace: string;
  cwd: string;
  policy: "saved" | "save";
  files: { path: string; sha256: string }[];
};

export function readBuildSourceReceipt(value: unknown): BuildSourceReceipt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.workspace !== "string" || typeof row.cwd !== "string" || !["saved", "save"].includes(String(row.policy)) || !Array.isArray(row.files) || row.files.length > 100) return null;
  const files: BuildSourceReceipt["files"] = [];
  for (const candidate of row.files) {
    if (!candidate || typeof candidate !== "object") return null;
    const file = candidate as Record<string, unknown>;
    if (typeof file.path !== "string" || !file.path || file.path.length > 500 || file.path.startsWith("/") || file.path.includes("\\") || file.path.split("/").some((part) => part === "..") || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
    files.push({ path: file.path, sha256: file.sha256 });
  }
  return { workspace: row.workspace.slice(0, 100), cwd: row.cwd.slice(0, 500), policy: row.policy as "saved" | "save", files };
}
