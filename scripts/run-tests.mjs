import { discoverTests } from "./test-inventory.mjs";
import { runDiscoveredTests } from "./test-runner.mjs";
const files = discoverTests();
console.log(`Running all ${files.length} discovered regression files.`);
process.exitCode = await runDiscoveredTests(files);
