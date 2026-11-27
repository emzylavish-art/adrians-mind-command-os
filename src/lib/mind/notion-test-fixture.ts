import type { NotionOperation, NotionOperationStore } from "./notion-operation-store.ts";

export function memoryStore() {
  const rows = new Map<string, NotionOperation>();
  const store: NotionOperationStore = {
    read: async (id) => rows.has(id) ? structuredClone(rows.get(id)!) : null,
    prepare: async (row) => { rows.set(row.id, structuredClone(row)); return row; },
    claim: async (id, fingerprint) => {
      const row = rows.get(id);
      if (!row || row.fingerprint !== fingerprint || row.state !== "prepared") return false;
      row.state = "dispatched"; return true;
    },
    finish: async (id, state, ids) => { const row = rows.get(id)!; row.state = state; if (ids) row.blockIds = ids; },
  };
  return { rows, store };
}
