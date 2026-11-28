import type { PreferenceStorage } from "./account-preferences.ts";
export const VOICE_PREFS = "mind.dictation.v1";
export const TRANSCRIPTS = "mind.dictation.history.v1";
export const voiceLanguages: Record<string,string> = { "": "Device language", "en-US":"English (US)", "en-GB":"English (UK)", "es-ES":"Español", "fr-FR":"Français", "de-DE":"Deutsch", "pt-BR":"Português", "ja-JP":"日本語", "hi-IN":"हिन्दी", "ar":"العربية", "zh-CN":"中文" };
export type VoicePreferences = { enabled:boolean; language:string; live:boolean; dictionary:string[]; history:boolean };
export const defaultVoicePreferences:VoicePreferences = {enabled:true,language:"",live:true,dictionary:[],history:false};
export function readVoicePreferences(storage: Pick<PreferenceStorage,"getItem">): VoicePreferences {
  try {
    const raw=JSON.parse(storage.getItem(VOICE_PREFS)||"{}");
    return {enabled:raw.enabled!==false,language:Object.hasOwn(voiceLanguages,raw.language)?raw.language:"",live:raw.live!==false,history:raw.history===true,
      dictionary:Array.isArray(raw.dictionary)?raw.dictionary.filter((word:unknown)=>typeof word==="string" && word.trim().length>0 && word.length<=80).slice(0,100):[]};
  } catch {return defaultVoicePreferences;}
}
export function formatDictation(text:string, dictionary:string[]) {
  if (!text || !dictionary.length) return text;
  const lexicon=new Map(dictionary.map(word=>[word.toLowerCase(),word]));
  const pattern=[...lexicon.keys()].sort((a,b)=>b.length-a.length).map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  if(!pattern) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`,"giu"), found=>lexicon.get(found.toLowerCase())??found);
}
export type Transcription = { at:string; text:string };
export function readTranscripts(storage:Pick<PreferenceStorage,"getItem">):Transcription[] {
  try {const data=JSON.parse(storage.getItem(TRANSCRIPTS)||"[]");return Array.isArray(data)?data.filter(row=>typeof row?.text==="string" && typeof row?.at==="string").slice(0,20):[];} catch{return [];}
}
export function recordDictation(storage:PreferenceStorage,text:string) {
  if(!text.trim() || !readVoicePreferences(storage).history) return;
  try {
    storage.setItem(TRANSCRIPTS,JSON.stringify([{text:text.slice(0,2000),at:new Date().toISOString()},...readTranscripts(storage)].slice(0,20)));
    if(typeof window!=="undefined")window.dispatchEvent(new Event("adrian-dictation-history"));
  } catch { /* Capture remains usable when the device is full. */ }
}
