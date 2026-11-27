import type { Chat, Workspace } from "@/lib/mind/types";

export function ArchiveSettings({ chats, ready, onRestore }: { chats: Chat[]; ready: boolean; onRestore:(id:string)=>void }) {
  const archived = chats.filter(chat=>chat.archived);
  return <section className="settings-card rounded-panel p-4 space-y-3"><h3>Archived chats</h3>
    <p className="text-sm text-muted">Restore a conversation to its original project and history.</p>
    {!ready ? <p role="status">Loading conversations…</p> : archived.length === 0 ? <p>No archived chats</p> : <ul>{archived.map(chat=><li className="settings-row" key={chat.id}><span>{chat.title || "Untitled chat"}</span><button className="min-h-11 rounded-panel border border-line px-3" type="button" onClick={()=>onRestore(chat.id)}>Unarchive</button></li>)}</ul>}
  </section>;
}
export function StorageSettings({ ws, ready, onOpen }: { ws: Workspace; ready: boolean; onOpen:(kind:"files"|"media")=>void }) {
  if (!ready) return <p role="status">Loading workspace storage…</p>;
  const files = ws.files;
  const images = new Map<string, number | null>();
  for (const chat of ws.chats) for (const message of chat.messages) for (const image of message.images ?? []) {
    const key = image.blobId || image.assetId || image.dataUrl;
    if (!key) continue;
    const inline = image.dataUrl?.split(",")[1];
    const size = inline ? Math.floor(inline.length * 3 / 4) - (inline.endsWith("==") ? 2 : inline.endsWith("=") ? 1 : 0) : null;
    if (size !== null || !images.has(key)) images.set(key, size);
  }
  const bytes = (value:number) => value < 1024 ? value+" B" : value < 1024*1024 ? (value / 1024).toFixed(1)+" KB" : (value / (1024*1024)).toFixed(1)+" MB";
  const totals=Array.from(images.values()), missing=totals.filter(n=>n===null).length;
  return <section className="settings-card rounded-panel p-4 text-sm space-y-3"><h3>Workspace storage</h3>
    <div className="settings-row"><div><strong>Files</strong><p>{files.length} documents · {bytes(files.reduce((sum,file)=>sum + file.bytes,0))} in recorded file sizes</p></div><button className="min-h-11 rounded-panel border border-line px-3" type="button" onClick={()=>onOpen("files")}>Manage files</button></div>
    <div className="settings-row"><div><strong>Images</strong><p>{images.size} distinct image references · {bytes(totals.reduce<number>((sum,n)=>sum+(n??0),0))} measured{missing>0 ? ` · ${missing} sizes unavailable`:""}</p></div><button className="min-h-11 rounded-panel border border-line px-3" type="button" onClick={()=>onOpen("media")}>Manage media</button></div>
  </section>;
}
