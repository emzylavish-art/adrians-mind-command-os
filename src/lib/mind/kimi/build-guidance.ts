import { skillApplicationContext, type SkillApplicationReceipt } from "../skill-activation.ts";

/** Only task guidance is added. Build mode and file/terminal authorization stay outside it. */
export function prepareBuildTask(value: unknown, skills: unknown): { ok: true; prompt: string; skillReceipts: SkillApplicationReceipt[] } | { ok: false; error: string } {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: "A coding task is required." };
  if (value.length > 8000) return { ok: false, error: "The coding task exceeds 8,000 characters. Shorten it explicitly; it was not silently truncated." };
  const guidance = skillApplicationContext(skills, "build");
  return { ok: true, prompt: guidance.text ? `${guidance.text}\n\nOwner coding task:\n${value.trim()}` : value.trim(), skillReceipts: guidance.receipts };
}
