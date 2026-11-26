import assert from "node:assert/strict";
import { test } from "node:test";
import { readDocumentOriginal, removeDocumentOriginal, saveDocumentOriginal } from "./document-originals.ts";
import { MAX_DOCUMENT_INPUT_BYTES } from "./knowledge-limits.ts";

/** Minimal transaction fixture: no external browser/account and no disk service. */
function fakeIndexedDb() {
  const databases = new Map<string, Map<string, unknown>>();
  const control = { failWrites: false };
  const factory = {
    open(name: string) {
      const existing = databases.has(name);
      if (!existing) databases.set(name, new Map());
      const values = databases.get(name)!;
      const db = {
        createObjectStore() {}, close() {},
        transaction() {
          const tx = {
            oncomplete: undefined as undefined | (() => void),
            onabort: undefined as undefined | (() => void),
            onerror: undefined as undefined | (() => void),
            error: null as Error | null,
            objectStore() {
              const write = (action: () => void) => queueMicrotask(() => {
                if (control.failWrites) { tx.error = new Error("Fixture storage rejected"); tx.onabort?.(); }
                else { action(); tx.oncomplete?.(); }
              });
              return {
                put(record: { id: string }) { write(() => values.set(record.id, record)); },
                delete(id: string) { write(() => values.delete(id)); },
                get(id: string) {
                  const request = { result: undefined as unknown, onsuccess: undefined as undefined | (() => void) };
                  queueMicrotask(() => { request.result = values.get(id); request.onsuccess?.(); });
                  return request;
                },
              };
            },
          };
          return tx;
        },
      };
      const request = { result: db, onupgradeneeded: undefined as undefined | (() => void), onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => { if (!existing) request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, control };
}

test("C1/AA077-078: original bytes are owner-scoped, hash-identified, downloadable and removable", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const fixture = fakeIndexedDb();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixture.factory });
  try {
    const file = new File(["Original Juniper document"], "plan.txt", { type: "text/plain" });
    const record = await saveDocumentOriginal("owner-a", file, "same-id");
    assert.equal(record.bytes, file.size);
    assert.equal(record.storage, "browser");
    assert.match(record.sha256, /^[a-f0-9]{64}$/);
    assert.equal(await (await readDocumentOriginal("owner-a", record.id))?.text(), "Original Juniper document");
    assert.equal(await readDocumentOriginal("owner-b", record.id), null);
    await assert.rejects(readDocumentOriginal("owner-a", record.id, "0".repeat(64)), /checksum mismatch/);
    assert.equal(await (await readDocumentOriginal("owner-a", record.id, record.sha256))?.text(), "Original Juniper document");
    await saveDocumentOriginal("owner-b", new File(["Other owner"], "other.txt"), "same-id");
    await removeDocumentOriginal("owner-a", record.id);
    assert.equal(await readDocumentOriginal("owner-a", record.id), null);
    assert.equal(await (await readDocumentOriginal("owner-b", record.id))?.text(), "Other owner");
    fixture.control.failWrites = true;
    await assert.rejects(saveDocumentOriginal("owner-a", file, "failed"), /storage rejected/);
    assert.equal(await readDocumentOriginal("owner-a", "failed"), null);
    await assert.rejects(removeDocumentOriginal("owner-b", "same-id"), /storage rejected/);
    assert.equal(await (await readDocumentOriginal("owner-b", "same-id"))?.text(), "Other owner");
    await assert.rejects(saveDocumentOriginal("owner-a", new File([new Uint8Array(MAX_DOCUMENT_INPUT_BYTES + 1)], "large.bin")), /5 MB/);
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
