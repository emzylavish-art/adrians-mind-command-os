import assert from "node:assert/strict";
import { test } from "node:test";
import { accountImageStore, MEDIA_BLOB_DB, MEDIA_BLOB_STORE } from "./blob-store.ts";

/** Transaction fixture: no browser, account, network or real media is accessed. */
function syntheticIdb() {
  const databases = new Map<string, Map<string, string>>([[MEDIA_BLOB_DB, new Map([["same", "unowned legacy pixels"]])]]);
  const opened: string[] = [];
  const control = { abortWrites: false, closes: 0 };
  const factory = {
    open(name: string) {
      opened.push(name);
      const existing = databases.has(name);
      if (!existing) databases.set(name, new Map());
      const rows = databases.get(name)!;
      const db = {
        objectStoreNames: { contains: (value: string) => value === MEDIA_BLOB_STORE },
        createObjectStore() {}, close() { control.closes++; },
        transaction() {
          const tx = {
            oncomplete: undefined as undefined | (() => void),
            onabort: undefined as undefined | (() => void),
            onerror: undefined as undefined | (() => void),
            error: null as Error | null,
            objectStore() {
              return {
                put(value: string, id: string) {
                  queueMicrotask(() => {
                    if (control.abortWrites) { tx.error = new Error("Fixture write aborted"); tx.onabort?.(); }
                    else { rows.set(id, value); tx.oncomplete?.(); }
                  });
                },
                get(id: string) {
                  const request = { result: undefined as string | undefined, onsuccess: undefined as undefined | (() => void) };
                  queueMicrotask(() => { request.result = rows.get(id); request.onsuccess?.(); });
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
    deleteDatabase(name: string) {
      const request = { onsuccess: undefined as undefined | (() => void) };
      queueMicrotask(() => { databases.delete(name); request.onsuccess?.(); });
      return request;
    },
  };
  return { factory: factory as unknown as IDBFactory, databases, opened, control };
}

test("C1/AA088: owner image reads never adopt unowned legacy pixels; account deletion stays scoped", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const fixture = syntheticIdb();
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: fixture.factory });
  try {
    const a = accountImageStore("owner/a"), b = accountImageStore("owner-b");
    assert.equal(await a.get("same"), undefined);
    await a.put("same", "owner-a pixels");
    assert.equal(await b.get("same"), undefined);
    await b.put("same", "owner-b pixels");
    assert.equal(await accountImageStore(null).get("same"), undefined);
    assert.equal(await accountImageStore("owner/a").get("same"), "owner-a pixels", "reload reopens only this owner's store");
    await a.clear();
    assert.equal(await a.get("same"), undefined);
    assert.equal(await b.get("same"), "owner-b pixels");
    assert.equal(fixture.databases.get(MEDIA_BLOB_DB)?.get("same"), "unowned legacy pixels");
    assert.equal(fixture.opened.includes(MEDIA_BLOB_DB), false);
    const closedBefore = fixture.control.closes;
    fixture.control.abortWrites = true;
    await assert.rejects(a.put("failed", "discarded"), /write aborted/);
    assert.equal(fixture.control.closes, closedBefore + 1, "failed writes must release the database handle");
    assert.equal(await a.get("failed"), undefined);
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
