#!/usr/bin/env node
import { resolveDatabaseUrl } from "./database-url.mjs";
const url = resolveDatabaseUrl(process.env) ?? "";
if (!url) {
  console.error("No DATABASE_URL/POSTGRES_URL. The hosted worker has no queue to poll. Nothing ran.");
  process.exit(2);
}
if (url.includes("ybxowvzicirinpdcfyqe") || url.includes("espmxiitzucooxblmnpr")) {
  console.error("Refusing a forbidden database. Nothing ran.");
  process.exit(1);
}
console.error("A hosted worker process is not provisioned for this database. Nothing ran.");
process.exit(2);
