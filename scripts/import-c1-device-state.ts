import { readLegacyDeviceSnapshot, validateLegacyDeviceSnapshot, importLegacyDeviceSnapshot } from "../src/lib/mind/pc-pairing/import-legacy.server.ts";
const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const source = value("--source");
const owner = value("--owner");
if (!source || !owner) throw new Error("Usage: node --experimental-strip-types scripts/import-c1-device-state.ts --source /absolute/legacy/mind-pc-pairing --owner OWNER [--apply]");
const snapshot = readLegacyDeviceSnapshot(source, owner);
validateLegacyDeviceSnapshot(snapshot);
if (!args.includes("--apply")) console.log(JSON.stringify({ mode: "read-only", fingerprint: snapshot.fingerprint, agents: snapshot.agents.length, jobs: snapshot.jobs.length, events: snapshot.events.length, note: "No database write. Back up the source and pause legacy writers before an explicitly approved --apply migration." }));
else {
  const { resolveDatabaseUrl } = await import("../src/lib/env.server.ts");
  if (!resolveDatabaseUrl()) throw new Error("An explicitly configured shared destination database is required for --apply.");
  const { getSql } = await import("../src/lib/db.ts");
  console.log(JSON.stringify(await importLegacyDeviceSnapshot(await getSql(), snapshot)));
}
