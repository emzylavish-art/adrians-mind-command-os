import { useEffect,useState } from "react";
import { readTranscripts, TRANSCRIPTS, voiceLanguages, type VoicePreferences } from "@/lib/mind/voice-preferences";
import { useAccountPreferences } from "./account-preferences-context";
export function DictationSettings({ prefs, onChange }: {prefs:VoicePreferences;onChange:(next:VoicePreferences)=>void}) {
  const storage=useAccountPreferences();
  const [rows,setRows]=useState(()=>readTranscripts(storage));
  const [word,setWord]=useState(""),[status,setStatus]=useState("");
  useEffect(()=>{const refresh=()=>setRows(readTranscripts(storage));refresh();window.addEventListener("adrian-dictation-history",refresh);return()=>window.removeEventListener("adrian-dictation-history",refresh);},[storage]);
  const field="min-h-11 rounded-panel border border-line bg-surface px-3";
  function add(){const value=word.trim();if(!value)return;const dictionary=prefs.dictionary.filter(item=>item.toLowerCase()!==value.toLowerCase());if(dictionary.length>=100){setStatus("The dictionary holds 100 phrases.");return;}onChange({...prefs,dictionary:[...dictionary,value]});setWord("");setStatus("");}
  return <section className="settings-card rounded-panel p-4 text-sm space-y-3"><h3>Dictation</h3>
    <label className="settings-row">Enable composer dictation<input type="checkbox" checked={prefs.enabled} onChange={e=>onChange({...prefs,enabled:e.target.checked})}/></label>
    <label className="settings-row">Browser speech language<select className={field} value={prefs.language} onChange={e=>onChange({...prefs,language:e.target.value})}>{Object.entries(voiceLanguages).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="settings-row">Show live browser transcription<input type="checkbox" checked={prefs.live} onChange={e=>onChange({...prefs,live:e.target.checked})}/></label>
    <details><summary className="py-2 cursor-pointer">Voice dictionary · {prefs.dictionary.length} phrases</summary><p className="text-muted">Use your preferred spelling when a transcript contains a matching phrase.</p>
      <label>Word or phrase<input className={field+" w-full"} maxLength={80} value={word} onChange={e=>setWord(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.nativeEvent.isComposing){e.preventDefault();add();}}}/></label><button type="button" className={field} onClick={add} disabled={!word.trim()}>Add phrase</button>
      <ul>{prefs.dictionary.map(item=><li className="settings-row" key={item}>{item}<button type="button" className={field} onClick={()=>onChange({...prefs,dictionary:prefs.dictionary.filter(value=>item!==value)})}>Remove</button></li>)}</ul></details>
    <label className="settings-row"><span>Save recent dictation transcripts<small className="block text-muted">Keep the last 20 transcripts on this device. Audio is discarded.</small></span><input type="checkbox" checked={prefs.history} onChange={e=>onChange({...prefs,history:e.target.checked})}/></label>
    <details><summary className="py-2 cursor-pointer">Recent dictation</summary>{rows.length ? <><ul>{rows.map((row,i)=><li key={i} className="py-2"><time className="text-xs text-muted">{new Date(row.at).toLocaleString()}</time><p>{row.text}</p></li>)}</ul><button type="button" className={field} onClick={()=>{try{storage.removeItem(TRANSCRIPTS);setRows([]);}catch{setStatus("Unable to remove saved transcripts.");}}}>Clear transcripts</button></> : <p>No saved transcripts.</p>}</details>
    <p role="status">{status}</p></section>;
}
