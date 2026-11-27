import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const commandCenter = readFileSync(new URL("./agent-command-center.tsx", import.meta.url), "utf8");
const statusHook = readFileSync(new URL("./dashboard-3d/use-dashboard-status.ts", import.meta.url), "utf8");

describe("dashboard live graph contract", () => {
  it("shows the existing 3D graph on first dashboard load", () => {
    assert.match(commandCenter, /const \[operations, setOperations\] = useState\(true\)/);
    assert.match(commandCenter, /section, setSection\] = useState<Section>\("3D Map"\)/);
    assert.match(commandCenter, /<Dashboard3D embedded status=\{status\}/);
  });

  it("feeds the graph from the live dashboard status endpoint and refreshes it", () => {
    assert.match(statusHook, /fetch\("\/api\/mind\/dashboard\/status"/);
    assert.match(statusHook, /window\.setInterval\(\(\) => void refresh\(\), POLL_MS\)/);
  });
});
