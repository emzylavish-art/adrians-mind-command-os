export const HOSTED_ACTIONS = [
  { id: "file_read", label: "File read" },
  { id: "file_write", label: "File write" },
  { id: "file_delete", label: "File delete" },
  { id: "terminal", label: "Terminal command" },
] as const;

export type HostedActionId = (typeof HOSTED_ACTIONS)[number]["id"];

export const CANNOT_RUN = [
  "Browser pointer on your PC",
  "Microphone after the browser closes",
] as const;

export const INSTALLER_HREF = "/downloads/AdriansMind-Setup.exe";

export const DESKTOP_ACTIONS = [
  { id: "mouse", label: "Mouse" },
  { id: "keyboard", label: "Keyboard" },
  { id: "screen", label: "Screen" },
  { id: "pc_file", label: "Files on your Windows PC" },
] as const;

export type DesktopActionId = (typeof DESKTOP_ACTIONS)[number]["id"];

export function exactDesktopAction(id: DesktopActionId): string {
  if (id === "mouse") return "mouse move 0,0";
  if (id === "keyboard") return "keyboard type desktop-ok";
  if (id === "screen") return "screen read approved-window";
  return "pc_file read Desktop\\adrian-proof.txt";
}

export function canRunDesktop(input: { halted: boolean; paired: boolean; approved: string | null; exact: string }): { ok: boolean; message: string } {
  if (input.halted) return { ok: false, message: "Emergency stop is on. Nothing ran." };
  if (!input.paired) return { ok: false, message: "No computer is paired. Nothing ran on a Windows PC." };
  if (input.approved !== input.exact) return { ok: false, message: "Approve this exact desktop action first. Nothing ran." };
  return { ok: false, message: "The browser does not move the mouse or type on the PC. The paired companion runs that action. Nothing ran here." };
}

export const DEMO_FILE = "owner-flow-demo.txt";
export const DEMO_COMMAND = "printf hosted-ok";
export const DEMO_WRITE = "hosted owner flow\n";

export function exactAction(id: HostedActionId): string {
  if (id === "file_read") return `file_read ${DEMO_FILE}`;
  if (id === "file_write") return `file_write ${DEMO_FILE}`;
  if (id === "file_delete") return `file_delete ${DEMO_FILE}`;
  return `terminal ${DEMO_COMMAND}`;
}

export function canRunApproved(input: { halted: boolean; approved: string | null; exact: string }): { ok: boolean; message: string } {
  if (input.halted) return { ok: false, message: "Emergency stop is on. Nothing ran." };
  if (input.approved !== input.exact) return { ok: false, message: "Approve this exact action first. Nothing ran." };
  return { ok: true, message: "" };
}

export function recordingContinuesAfterTabClose(): false {
  return false;
}
