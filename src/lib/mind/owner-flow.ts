export const HOSTED_ACTIONS = [
  { id: "file_read", label: "File read" },
  { id: "file_write", label: "File write" },
  { id: "file_delete", label: "File delete" },
  { id: "terminal", label: "Terminal command" },
] as const;

export type HostedActionId = (typeof HOSTED_ACTIONS)[number]["id"];

export const CANNOT_RUN = [
  "Windows desktop software",
  "Mouse",
  "Keyboard",
  "Browser pointer on your PC",
  "Microphone after the browser closes",
  "Files on your Windows PC",
] as const;

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
