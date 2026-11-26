import { createHash } from "node:crypto";

export type PcActionKind = "list_files" | "read_file" | "write_file" | "make_folder" | "run_command" | "move_pointer" | "click" | "right_click" | "double_click" | "scroll" | "drag" | "type_text" | "dictation" | "capture_screen" | "open_browser" | "launch_app" | "list_windows" | "focus_window" | "window_action" | "list_monitors" | "accessibility" | "find_button" | "invoke_button" | "vision" | "worker";
export type PcAction = { id: string; kind: PcActionKind; target: "current-device"; permission: "read" | "modify" | "external_image"; args: string[]; dependsOn: string[]; expected: string };
export type PcPlan = { id: string; actions: PcAction[]; recognized: boolean; error?: string };
export type PcActionReceipt = { actionId: string; kind: PcActionKind; target: string; permission: PcAction["permission"]; state: "blocked" | "attempted" | "completed" | "failed" | "verified" | "unconfirmed" | "canceled"; attempted: boolean; output: string; at: string };
export type PcExecution = { recognized: boolean; authorized: boolean; attempted: boolean; ran: boolean; completed: boolean; verified: boolean; state: "unrecognized" | "blocked" | "completed" | "failed" | "unconfirmed" | "canceled"; output: string; plan: PcPlan; receipts: PcActionReceipt[]; destination: { kind: "local"; deviceId: string } };

const PATTERNS: Array<[PcActionKind, RegExp, PcAction["permission"]]> = [
  ["write_file", /^write file\s+([A-Za-z0-9._ /-]+):\s*([\s\S]{1,20000})$/i, "modify"],
  ["run_command", /^run command\s+([^\n]{1,400})$/i, "modify"],
  ["type_text", /^type\s+"([^"]{1,200})"$/i, "modify"],
  ["dictation", /^insert dictation at cursor:\s*([\s\S]{1,20000})$/i, "modify"],
  ["list_files", /^(?:my files|my desktop|list (?:my )?(?:files|desktop)|open my (?:files|desktop)|go to my files)$/i, "read"],
  ["read_file", /^read file\s+([A-Za-z0-9._ /-]+)$/i, "read"],
  ["make_folder", /^make folder\s+([A-Za-z0-9._ -]+)$/i, "modify"],
  ["move_pointer", /^(?:move the mouse|move my mouse)$/i, "modify"],
  ["right_click", /^right-click\s+(\d{1,4})\s+(\d{1,4})$/i, "modify"],
  ["double_click", /^double-click\s+(\d{1,4})\s+(\d{1,4})$/i, "modify"],
  ["click", /^click\s+(\d{1,4})\s+(\d{1,4})$/i, "modify"],
  ["scroll", /^scroll\s+(up|down)$/i, "modify"],
  ["drag", /^drag\s+(\d{1,4})\s+(\d{1,4})\s+to\s+(\d{1,4})\s+(\d{1,4})$/i, "modify"],
  ["capture_screen", /^(?:look at my screen|what is on my screen|drive the screen|read my screen)$/i, "read"],
  ["open_browser", /^open my browser(?:\s+(https:\/\/\S+))?$/i, "modify"],
  ["launch_app", /^launch app\s+([A-Za-z0-9 ._-]{1,80})$/i, "modify"],
  ["list_windows", /^list windows$/i, "read"],
  ["focus_window", /^switch window\s+([A-Za-z0-9 ._-]{1,80})$/i, "modify"],
  ["window_action", /^(minimize|maximize|close) window\s+([A-Za-z0-9 ._-]{1,80})$/i, "modify"],
  ["list_monitors", /^list monitors$/i, "read"],
  ["accessibility", /^read accessibility$/i, "read"],
  ["find_button", /^find button\s+(.{1,80})$/i, "read"],
  ["invoke_button", /^click button\s+"([^"]{1,80})"\s+in window\s+"([^"]{1,120})"$/i, "modify"],
  ["vision", /^understand (?:the )?screenshot$/i, "external_image"],
  ["worker", /^keep working after close$/i, "modify"],
];

function clausesOutsideQuotes(input: string): string[] {
  const clauses: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    if (input[index] === '"' && input[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    const separator = input.slice(index).match(/^(?:\s+(?:then|and)\s+|\r?\n)/);
    if (!separator) continue;
    const current = input.slice(start, index).trim();
    if (/^(?:write file\b|run command\b|insert dictation at cursor:)/i.test(current)) break;
    if (current) clauses.push(current);
    index += separator[0].length - 1;
    start = index + 1;
  }
  const tail = input.slice(start).trim();
  if (tail) clauses.push(tail);
  return clauses;
}

export function planPcRequest(text: string): PcPlan {
  const input = text.trim();
  // Payload-bearing commands are opaque. Words inside content are never a second action.
  const clauses = /^(?:write file\b|run command\b|insert dictation at cursor:)/i.test(input)
    ? [input] : clausesOutsideQuotes(input);
  const actions: PcAction[] = [];
  let error: string | undefined;
  for (const clause of clauses.slice(0, 20)) {
    const definition = PATTERNS.find(([, pattern]) => pattern.test(clause));
    if (!definition) { if (actions.length || clauses.length > 1) error = "A request contains an unsupported or ambiguous action. Review a precise plan; nothing ran."; continue; }
    const [kind, pattern, permission] = definition;
    const id = `step-${actions.length + 1}`;
    actions.push({ id, kind, target: "current-device", permission, args: (clause.match(pattern)?.slice(1) ?? []).map(value => value ?? ""), dependsOn: actions.length ? [actions.at(-1)!.id] : [], expected: permission === "read" ? "A local observation, without interaction" : permission === "external_image" ? "An explicitly selected model receipt" : "An operation receipt; final application state remains unverified unless independently checked" });
  }
  if (clauses.length > 20) error = "A computer plan may contain at most 20 actions.";
  const id = createHash("sha256").update(JSON.stringify(actions)).digest("hex");
  return { id, actions, recognized: actions.length > 0 || !!error, ...(error ? { error } : {}) };
}

/** Typed ordering and per-step permission rechecks; no OS primitive lives in this core. */
export async function executePcPlan(plan: PcPlan, deps: {
  deviceId: string; halted: () => boolean | Promise<boolean>;
  authorize?: (action: PcAction) => boolean | Promise<boolean>;
  execute: (action: PcAction) => Promise<{ state: "completed" | "failed" | "verified" | "unconfirmed" | "blocked"; output: string; attempted?: boolean }>;
  signal?: AbortSignal; now?: () => string;
}): Promise<PcExecution> {
  const receipts: PcActionReceipt[] = [];
  const now = deps.now ?? (() => new Date().toISOString());
  const validIds = new Set<string>();
  let planError = plan.error;
  for (const action of plan.actions) {
    const definition = PATTERNS.find(([kind]) => kind === action.kind);
    if (!definition || action.permission !== definition[2] || plan.actions.length > 20 || !action.args.every(arg => typeof arg === "string" && arg.length <= 20_000) || validIds.has(action.id) || action.target !== "current-device" || action.dependsOn.some(id => !validIds.has(id))) planError = "The plan has invalid targets, duplicate IDs or dependency order. Nothing ran.";
    validIds.add(action.id);
  }
  let authorized = plan.recognized && !planError;
  for (const action of plan.actions) {
    let state: PcActionReceipt["state"] = "blocked";
    let attempted = false;
    let dispatched = false;
    let output = planError || "";
    try {
      if (planError) authorized = false;
      else if (deps.signal?.aborted) { state = "canceled"; output = "Canceled before this action was dispatched."; authorized = false; }
      else if (await deps.halted()) { output = "Emergency stop is on. This action was not dispatched."; authorized = false; }
      else if (action.dependsOn.some(id => !receipts.some(receipt => receipt.actionId === id && (receipt.state === "completed" || receipt.state === "verified")))) output = "A prerequisite did not complete. This dependent action was not dispatched.";
      else if (deps.authorize && !await deps.authorize(action)) { output = "Current permission does not authorize this action. Nothing was dispatched."; authorized = false; }
      else {
        dispatched = true;
        const result = await deps.execute(action);
        state = result.state;
        output = result.output;
        attempted = result.attempted ?? result.state !== "blocked";
      }
    } catch { state = dispatched ? "unconfirmed" : "blocked"; attempted = dispatched; authorized = dispatched && authorized; output = dispatched ? "The action stopped after dispatch. Its final effect is unconfirmed; inspect the device before retrying." : "Permission state could not be verified. This action was not dispatched."; }
    receipts.push({ actionId: action.id, kind: action.kind, target: deps.deviceId, permission: action.permission, state, attempted, output, at: now() });
  }
  const attempted = receipts.some(receipt => receipt.attempted);
  const completed = receipts.length > 0 && receipts.every(receipt => receipt.state === "completed" || receipt.state === "verified");
  const verified = receipts.length > 0 && receipts.every(receipt => receipt.state === "verified");
  const state = !plan.recognized ? "unrecognized" : completed ? "completed" : receipts.some(receipt => receipt.state === "canceled") ? "canceled" : receipts.some(receipt => receipt.state === "unconfirmed") ? "unconfirmed" : attempted ? "failed" : "blocked";
  return { recognized: plan.recognized, authorized, attempted, ran: attempted, completed, verified, state, output: receipts.map(receipt => receipt.output).join("\n") || planError || "", plan, receipts, destination: { kind: "local", deviceId: deps.deviceId } };
}
