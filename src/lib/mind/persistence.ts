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
      note: "The browser keeps its own copy. The server database is in-memory and resets when the process restarts. That is not cloud backup. The emergency-stop file is local disk and is not durable on a serverless instance.",
    };
  }
  return {
    backend: "postgres",
    cloudBackup: false,
    restartChecked: false,
    note: "DATABASE_URL is set. A restart test against that database was not run here. The browser copy and the server copy stay separate. This is not verified cloud backup.",
  };
}
