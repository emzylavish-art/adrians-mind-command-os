import { guardMindEnv } from "./isolation.ts";

export function describePersistence(databaseUrl: string | undefined): {
  backend: "memory" | "postgres" | "refused";
  cloudBackup: false;
  restartChecked: false;
  note: string;
} {
  const gate = guardMindEnv({ databaseUrl });
  if (!gate.ok) {
    return {
      backend: "refused",
      cloudBackup: false,
      restartChecked: false,
      note: gate.error,
    };
  }
  if (!databaseUrl?.trim()) {
    return {
      backend: "memory",
      cloudBackup: false,
      restartChecked: false,
      note: "The browser keeps its own copy. Without DATABASE_URL the server uses a PGLite file on this machine (.data/pglite). That file can survive a process restart here. It is not cloud backup, and a serverless host does not keep it.",
    };
  }
  return {
    backend: "postgres",
    cloudBackup: false,
    restartChecked: false,
    note: "DATABASE_URL is set. A restart test against that database was not run here. The browser copy and the server copy stay separate. This is not verified cloud backup.",
  };
}

export function databaseMode(backend: "memory" | "postgres" | "refused"): { pill: string; detail: string } {
  if (backend === "postgres") return { pill: "Remote configured", detail: "DATABASE_URL is set. No restart test was run against that host." };
  if (backend === "refused") return { pill: "Refused", detail: "This database URL is not allowed." };
  return { pill: "Local file", detail: "A file on this machine. No hosted database is connected." };
}

export function hostedDatabaseSetup() {
  return {
    variables: ["DATABASE_URL"],
    migrate: "npm run db:migrate",
    forbidden: ["ybxowvzicirinpdcfyqe", "espmxiitzucooxblmnpr"],
  };
}
