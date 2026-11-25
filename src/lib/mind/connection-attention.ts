import type { AuditEntry } from "./types.ts";

export function notionSearchIssue(entries: AuditEntry[]): AuditEntry | null {
  const last = entries.find((row) => row.target === "notion:search");
  return last && last.action !== "notion_search_recovered" && last.action !== "notion_search_disconnected" ? last : null;
}

export function retainActivity(entries: AuditEntry[]): AuditEntry[] {
  if (entries.length <= 200) return entries;
  const issue = notionSearchIssue(entries);
  const retained = entries.slice(0, 200);
  if (issue && !retained.includes(issue)) retained[199] = issue;
  return retained;
}
