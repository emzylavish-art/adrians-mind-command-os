import { parseModeInstruction, scopedInstruction } from "../mode-instructions.ts";
import { skillApplicationContext, type SkillApplicationReceipt } from "../skill-activation.ts";

export const MAX_BUILD_TASK_CHARACTERS = 8_000;

/** Only task guidance is added. Build mode and file/terminal authorization stay outside it. */
export function prepareBuildTask(value: unknown, skills: unknown, instruction?: unknown): { ok: true; prompt: string; skillReceipts: SkillApplicationReceipt[] } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: "A coding task is required." };
  if (value.length > MAX_BUILD_TASK_CHARACTERS) return { ok: false, error: "The coding task exceeds 8,000 characters. Shorten it explicitly; it was not silently truncated." };
  const guidance = skillApplicationContext(skills, "build");
  const mode = parseModeInstruction(instruction);
  if (!mode.ok) return mode;
  const context = [scopedInstruction(mode.text), guidance.text].filter(Boolean).join("\n\n");
  return { ok: true, prompt: context ? `${context}\n\nOwner coding task:\n${value.trim()}` : value.trim(), skillReceipts: guidance.receipts };
}
