/**
 * Node contract runner (no browser): same assertion as chip-sse-contract.test.ts.
 * Exit 0 when every tier's chip label contains the mapped model id.
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chipLabelForTier, resolveModelTier } = await import(pathToFileURL(join(root, "src/lib/mind/model-tiers.ts")).href);

let failed = 0;
for (const tier of ["Fast", "Expert", "Heavy", "Build", "Auto"]) {
  const resolved = resolveModelTier(tier, tier === "Auto" ? "Hi" : "probe", {});
  const doneModel = resolved.model;
  const label = chipLabelForTier({
    selected: resolved.selected,
    lastResolved: resolved.resolved,
    lastModel: doneModel,
  });
  const ok = label.includes(doneModel);
  console.log(JSON.stringify({ tier, doneModel, label, ok }));
  if (!ok) failed += 1;
}
process.exit(failed ? 1 : 0);
