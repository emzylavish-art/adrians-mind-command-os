import { LOCAL_BUILD, LOCAL_VERSION } from "./desktop-update.ts";

export const ADRIAN_REPOSITORY = "https://github.com/emzylavish-art/adrians-mind-command-os";
export const bugAreas = ["Chat", "Work", "Build", "Research", "Plugins", "Skills", "Voice", "Settings", "Dashboard", "Sign-in", "Other"] as const;
export const bugSymptoms = ["An action failed", "A control is missing", "An unexpected result appeared", "The page stopped responding", "A layout or accessibility issue"] as const;

export function publishedPolicyUrl(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function revisionLabel(value: unknown) {
  return typeof value === "string" && /^[a-f\d]{7,64}$/i.test(value) ? value.slice(0, 12) : null;
}

/** Only selected labels and coarse runtime facts enter the GitHub draft. */
export function previewBugReport(area: string, symptom: string, diagnostics?: { online: boolean; installed: boolean; revision: unknown }) {
  const section = bugAreas.find(item => item === area) ?? "Other";
  const issue = bugSymptoms.find(item => item === symptom) ?? "An action failed";
  const title = section + " — " + issue;
  const lines = ["## Issue", title];
  if (diagnostics) {
    lines.push("", "## Diagnostics", "App: Adrian Mind OS", "Display: " + (diagnostics.installed ? "installed web app" : "browser window"),
      "Browser network status: " + (diagnostics.online ? "online" : "offline"),
      "Web revision: " + (revisionLabel(diagnostics.revision) ?? "unreported"),
      "Published Windows package: " + LOCAL_VERSION + " (build " + LOCAL_BUILD + ")");
  }
  const body = lines.join("\n");
  const url = new URL(ADRIAN_REPOSITORY + "/issues/new");
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  return { title, body, url: url.href };
}
