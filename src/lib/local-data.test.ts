import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { localDataPath } from "./local-data.ts";

test("preview data stays under the working directory", () => {
  assert.equal(localDataPath("pglite", {}, "/app"), join("/app", ".data", "pglite"));
});

test("an installed app can keep data outside the program folder", () => {
  assert.equal(
    localDataPath("pglite", { ADRIAN_DATA_DIR: "C:/Users/owner/AppData/Roaming/AdriansMind" }, "/program"),
    join("C:/Users/owner/AppData/Roaming/AdriansMind", "pglite"),
  );
});

test("a blank data folder does not move the preview", () => {
  assert.equal(localDataPath("mind-halt", { ADRIAN_DATA_DIR: "  " }, "/app"), join("/app", ".data", "mind-halt"));
});
