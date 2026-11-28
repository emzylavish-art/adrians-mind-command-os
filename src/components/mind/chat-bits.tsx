import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { BITS_KEY, bitImage, bitName, defaultBits, gallery, readBits, type BitPreferences } from "@/lib/mind/chat-bits";
import { useAccountPreferences } from "./account-preferences-context";

type NativeBits = { configure: (bits: { image: string; visible: boolean; corner: string; name: string }) => Promise<boolean>; onActivate: (listener: () => void) => () => void };
declare global { interface Window { adrianBits?: NativeBits } }
const control = "min-h-11 rounded-panel border border-line bg-surface px-3";
async function normalizePet(source: string) {
  const photo = new Image(); photo.src = source; await photo.decode();
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Your browser could not open this image.");
  const scale = Math.min(256 / photo.naturalWidth,256 / photo.naturalHeight);
  const w = photo.naturalWidth * scale, h = photo.naturalHeight * scale;
  context.drawImage(photo,(256-w)/2,(256-h)/2,w,h);
  return canvas.toDataURL("image/png");
}
export function ChatBits({ panel, chats, onActivate, generate, blockGeneration }: { panel: HTMLElement | null; chats: {id:string; title:string}[]; onActivate:(id:string)=>void; generate:(description:string)=>Promise<string>; blockGeneration?:string }) {
  const storage = useAccountPreferences();
  const [bits, setBits] = useState<BitPreferences>(defaultBits), [loaded,setLoaded] = useState(false);
  const [status,setStatus]=useState(""), [prompt,setPrompt]=useState(""), [working,setWorking]=useState(false);
  const file = useRef<HTMLInputElement>(null);
  const latest = useRef(bits); latest.current=bits;
  const owner = useRef(storage); owner.current=storage;
  const activate = useRef<()=>void>(()=>{}); activate.current=()=>onActivate(bits.chat);
  useEffect(() => { try { setBits(readBits(storage.getItem(BITS_KEY))); } catch {setStatus("Browser preferences are unavailable.");} setLoaded(true); return () => { void window.adrianBits?.configure({image:"",visible:false,corner:"right",name:""}); }; },[storage]);
  useEffect(() => window.adrianBits?.onActivate(() => activate.current()), []);
  useEffect(() => {
    if (!loaded || !window.adrianBits) return;
    let alive=true;
    void window.adrianBits.configure({image:bitImage(bits),visible:bits.desktop,corner:bits.corner,name:bitName(bits)}).then((ok) => {
      if (alive && !ok && bits.desktop) setStatus("The desktop companion could not open.");
    }).catch(() => {if (alive) setStatus("Desktop companion unavailable.");});
    return () => {alive=false;};
  }, [bits,loaded]);
  function save(next:BitPreferences) {
    try {storage.setItem(BITS_KEY,JSON.stringify(next));setBits(next);setStatus("");}
    catch {setStatus("Your browser could not save the companion. The previous selection is still active.");}
  }
  async function upload(item:File) {
    const scope=storage;
    if (!["image/png","image/jpeg","image/webp","image/gif"].includes(item.type) || item.size>8*1024*1024) {setStatus("Choose a PNG, JPEG, WebP or GIF under 8 MB.");return;}
    const url=URL.createObjectURL(item);setWorking(true);
    try {const image=await normalizePet(url);if(owner.current===scope)save({...latest.current,image,selected:"custom",name:item.name.replace(/\.[^.]+$/,"").slice(0,50)});}
    catch {if(owner.current===scope)setStatus("This image could not be opened.");}
    finally {URL.revokeObjectURL(url);if(owner.current===scope)setWorking(false);}
  }
  async function create() {
    const scope=storage;setWorking(true);setStatus("Creating your companion…");
    try {const result=await generate(prompt.trim());const image=await normalizePet(result);if(owner.current===scope){save({...latest.current,image,selected:"custom",name:prompt.trim().slice(0,50)});setPrompt("");}}
    catch(error){if(owner.current===scope)setStatus(error instanceof Error?error.message:"Image creation failed.");}
    finally {if(owner.current===scope)setWorking(false);}
  }
  return <>
    {bits.visible && !panel && <button className="fixed bottom-20 z-30 rounded-full border border-line bg-surface p-1 shadow-panel" style={{[bits.corner]:16}} type="button" onClick={()=>activate.current()} aria-label={`Open Adrian Chat with ${bitName(bits)}`}><img src={bitImage(bits)} alt="" width={48} height={48}/></button>}
    {panel && createPortal(<section className="settings-card rounded-panel p-4 space-y-4 text-sm"><h3>Chat Bits</h3>
      <div className="flex items-center gap-3"><img width={76} height={76} src={bitImage(bits)} alt="Selected companion"/><div><strong>{bitName(bits)}</strong><p className="text-muted">Tap your companion to open Chat.</p></div></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[...gallery,...(bits.image?[{id:"custom",name:bits.name,description:"Your own companion."}]:[])].map((pet)=><button type="button" key={pet.id} className={control+" flex items-center gap-2 text-left py-2"} aria-pressed={bits.selected===pet.id} onClick={()=>save({...bits,selected:pet.id})}><img width={40} height={40} src={pet.id==="custom"?bits.image:`/chat-bits/${pet.id}.png`} alt=""/><span>{pet.name}{bits.selected===pet.id&&" ✓"}</span></button>)}</div>
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e)=>{const selected=e.target.files?.[0];e.target.value="";if(selected)void upload(selected);}}/>
      <button type="button" className={control} disabled={working} onClick={()=>file.current?.click()}>Upload companion</button>{" "}
      {bits.image && <button type="button" className={control} onClick={()=>save({...bits,image:"",name:"",selected:bits.selected==="custom"?"pip":bits.selected})}>Remove uploaded companion</button>}
      <details><summary className="py-2 cursor-pointer">Create a companion from a description</summary><label className="grid gap-2">Appearance<input className={control} value={prompt} maxLength={500} onChange={(e)=>setPrompt(e.target.value)} placeholder="A tiny silver fox with amber ears"/></label><p className="py-2 text-muted">{blockGeneration || "Uses your configured image provider and its generation charges."}</p><button type="button" className={control} disabled={Boolean(blockGeneration)||working||!prompt.trim()} onClick={()=>void create()}>Generate companion</button></details>
      <label className="settings-row">Show on the website<input type="checkbox" checked={bits.visible} onChange={(e)=>save({...bits,visible:e.target.checked})}/></label>
      {typeof window !== "undefined" && window.adrianBits ? <label className="settings-row">Float above desktop apps<input type="checkbox" checked={bits.desktop} onChange={(e)=>save({...bits,desktop:e.target.checked})}/></label> : <p className="text-muted">To float a Chat Bit above other Windows apps, enable it in the Adrian desktop app. On a phone, add the Chat link below to your home screen using the browser share menu.</p>}
      <label className="settings-row">Placement<select className={control} value={bits.corner} onChange={(e)=>save({...bits,corner:e.target.value==="left"?"left":"right"})}><option value="left">Bottom left</option><option value="right">Bottom right</option></select></label>
      <label className="settings-row">Open conversation<select className={control+" max-w-full"} value={chats.some((row)=>row.id===bits.chat)?bits.chat:""} onChange={(e)=>save({...bits,chat:e.target.value})}><option value="">Current chat</option>{chats.map((row)=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      <a className={control+" inline-flex items-center"} href={`?section=chat${chats.some((row)=>row.id===bits.chat)?"&chat="+encodeURIComponent(bits.chat):""}`}>Open Chat link</a><p role="status">{status}</p>
    </section>, panel)}
  </>;
}
