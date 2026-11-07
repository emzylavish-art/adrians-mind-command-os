import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/voice/ERROR_CONTRACT.md"), "utf8");

describe("ERROR_CONTRACT timeout scope", () => {
  it("matches 09dda8a for failure keys and limits the no-retry rule to MCP", () => {
    assert.match(doc, /09dda8a/);
    assert.match(doc, /ok === false/);
    assert.match(doc, /transport\.ok === false/);
    assert.match(doc, /rpc\.isError === true/);
    assert.match(doc, /numeric HTTP status is not the key/);
    assert.match(doc, /MCP tool calls only/);
    assert.match(doc, /user-pressed Retry/);
    assert.match(doc, /does not call the mint again/);
    assert.match(doc, /re-sends no chat turn/);
    assert.doesNotMatch(doc, /Retry only when `transport\.ok` is false or `code` is `timeout`/);
  });
});
