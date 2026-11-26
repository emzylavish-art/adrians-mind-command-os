#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateFeatureEvidence, validateEnvironmentEvidence, validateReleaseEvidence } from "./evidence.mjs";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const modes = ["--features", "--environments", "--release"].filter((name) => args.includes(name));
try {
  if (modes.length !== 1 || !args.includes("--revision") || !value("--revision") || !value(modes[0])) throw new Error("Usage: node scripts/verification/validate.mjs (--features|--environments|--release) <json-file> --revision <40-character-SHA> [--require-current]");
  const document = JSON.parse(readFileSync(value(modes[0]), "utf8"));
  const validators = { "--features": validateFeatureEvidence, "--environments": validateEnvironmentEvidence, "--release": validateReleaseEvidence };
  const result = validators[modes[0]](document, { revision: value("--revision"), requireCurrent: args.includes("--require-current") });
  console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
} catch (error) { console.error(error instanceof Error ? error.message : "Evidence validation failed."); process.exitCode = 1; }
