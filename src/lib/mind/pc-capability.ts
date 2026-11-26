export type PcState = "coded" | "missing";
export type PcCapability = { id: string; state: PcState; proof: string; verification: "unverified"; requirement: string; offline: "local" | "requires-local-engine" | "external" | "unavailable" };
const coded = (id: string, requirement: string, offline: PcCapability["offline"] = "local"): PcCapability => ({ id, state: "coded", requirement, offline, verification: "unverified", proof: "An adapter exists in source. Current device permission, execution and final outcome must be established by a fresh receipt." });
const missing = (id: string): PcCapability => ({ id, state: "missing", requirement: "No supported adapter is implemented.", offline: "unavailable", verification: "unverified", proof: "No runtime or physical-device readiness is claimed." });
export const PC_CAPABILITIES: readonly PcCapability[] = [
  coded("desktop-files", "Current local executor and owner-folder access"), coded("desktop-command", "Explicit bounded command, current permission and local executor"),
  coded("screen-capture", "Windows primary screen; local capture is separate from external vision"), coded("open-browser", "Windows and explicit URL"), coded("mouse-coordinate", "Windows and explicit coordinates"), coded("keyboard-text", "Windows and explicit text"),
  coded("visual-understanding", "Explicit selected model and external-image authorization; no implicit fallback", "external"), coded("accessibility-tree", "Windows UI Automation; discovery never invokes buttons"), coded("window-management", "Windows and exact selected window"), coded("installed-apps", "Explicit app launch only; installed-app discovery is not implemented"), coded("multi-monitor", "Monitor names only; capture remains primary screen"),
  coded("offline-text", "Healthy selected loopback model; no external fallback", "requires-local-engine"), coded("offline-speech", "Healthy local transcription/speech engines and microphone permission", "requires-local-engine"),
  ...["browser-automation", "background-worker", "cross-device", "workflow-studio", "extension-sandbox", "rollback", "robotics"].map(missing),
];
export function missingPcCapabilities(): string[] { return PC_CAPABILITIES.filter(item => item.state === "missing").map(item => item.id); }
