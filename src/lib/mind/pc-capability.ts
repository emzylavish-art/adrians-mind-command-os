export type PcState = "coded" | "missing";

export type PcCapability = {
  id: string;
  state: PcState;
  proof: string;
};

export const PC_CAPABILITIES: readonly PcCapability[] = [
  { id: "desktop-files", state: "coded", proof: "Tested on this machine inside a temporary folder. Not tested on the laptop." },
  { id: "desktop-command", state: "coded", proof: "A command can run inside the Desktop folder. Not tested on the laptop." },
  { id: "screen-capture", state: "coded", proof: "Windows-only. This Linux machine correctly refuses. No laptop screenshot was taken." },
  { id: "open-browser", state: "coded", proof: "Windows can be asked to open one URL. No page was read or clicked." },
  { id: "mouse-coordinate", state: "coded", proof: "A fixed point or exact coordinates only. No button finding." },
  { id: "keyboard-text", state: "coded", proof: "One quoted string. No shortcuts." },
  { id: "visual-understanding", state: "missing", proof: "No buttons, menus, or screen changes are read." },
  { id: "accessibility-tree", state: "missing", proof: "No Windows UI Automation tree is read." },
  { id: "window-management", state: "missing", proof: "No focus, minimize, maximize, or close by application name." },
  { id: "installed-apps", state: "missing", proof: "Installed applications are not discovered or launched by name." },
  { id: "multi-monitor", state: "missing", proof: "Only the primary screen is named in the capture script." },
  { id: "browser-automation", state: "missing", proof: "No Playwright or Stagehand session is driven from Speak." },
  { id: "background-worker", state: "missing", proof: "Bots step only while the installed app is open." },
  { id: "cross-device", state: "missing", proof: "No phone-to-PC task handoff exists." },
  { id: "workflow-studio", state: "missing", proof: "No natural-language workflow editor was added." },
  { id: "extension-sandbox", state: "missing", proof: "Adrian cannot install its own extensions." },
  { id: "rollback", state: "missing", proof: "No computer-action checkpoint or rollback exists." },
  { id: "robotics", state: "missing", proof: "No device interface was added." },
];

export function missingPcCapabilities(): string[] {
  return PC_CAPABILITIES.filter((item) => item.state === "missing").map((item) => item.id);
}
