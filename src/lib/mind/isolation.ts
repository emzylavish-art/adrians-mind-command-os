import { FORBIDDEN_REFS } from "./registry.ts";

export function guardMindEnv(env: {
  databaseUrl?: string;
  mindUrl?: string;
  mindRef?: string;
}): { ok: true } | { ok: false; error: string } {
  const databaseUrl = env.databaseUrl ?? "";
  const mindUrl = env.mindUrl ?? "";
  const mindRef = env.mindRef ?? "";
  for (const ref of FORBIDDEN_REFS) {
    if (databaseUrl.includes(ref) || mindUrl.includes(ref) || mindRef === ref) {
      return { ok: false, error: `Refused forbidden project ${ref}` };
    }
  }
  if (mindRef && mindUrl && !mindUrl.includes(mindRef)) {
    return { ok: false, error: "Mind project URL and project ref do not match." };
  }
  return { ok: true };
}
