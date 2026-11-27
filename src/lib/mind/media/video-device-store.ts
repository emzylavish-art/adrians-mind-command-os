export type VideoDeviceStore = { put(operationId: string, blob: Blob): Promise<void>; get(operationId: string): Promise<Blob | undefined> };
export function videoDeviceDatabaseName(ownerId: string) { return `amcos.video-copies.v1.${encodeURIComponent(ownerId)}`; }
export function videoDeviceStore(ownerId: string): VideoDeviceStore {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(videoDeviceDatabaseName(ownerId), 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("videos")) request.result.createObjectStore("videos"); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return {
    async put(id, blob) { const db = await open(); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction("videos", "readwrite"); tx.objectStore("videos").put(blob, id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } },
    async get(id) { const db = await open(); try { return await new Promise<Blob | undefined>((resolve, reject) => { const request = db.transaction("videos", "readonly").objectStore("videos").get(id); request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined); request.onerror = () => reject(request.error); }); } finally { db.close(); } },
  };
}

export async function verifyDeviceVideoCopy(store: VideoDeviceStore, operationId: string, blob: Blob): Promise<Blob> {
  if (!blob.size || blob.size > 50 * 1024 * 1024 || !["video/mp4", "video/webm"].includes(blob.type)) throw new Error("The video file is empty, unsupported or larger than the 50 MiB device-copy limit.");
  await store.put(operationId, blob);
  const saved = await store.get(operationId);
  if (!saved || saved.size !== blob.size || saved.type !== blob.type) throw new Error("The device copy could not be verified. Keep the source link or download a copy manually.");
  return saved;
}

export async function clearDeviceVideos(ownerId: string) {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(videoDeviceDatabaseName(ownerId)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Another tab is using this account's saved video copies.")); });
}
