export const SOKUJI_SOURCE = "https://github.com/kizuna-ai-lab/sokuji";
export const OPUS_MT_SOURCE = "https://github.com/Helsinki-NLP/Opus-MT";
export const REJECTED_GOOGLE_TRANSLATOR = "https://github.com/SamirPaulb/real-time-voice-translator";
export const OPUS_MT_URL = "http://127.0.0.1:4197/opus-mt";

export const TRANSLATOR_TARGETS = [
  { id: "en", label: "English" },
  { id: "aa", label: "Afar" },
  { id: "ab", label: "Abkhazian" },
  { id: "ae", label: "Avestan" },
  { id: "af", label: "Afrikaans" },
  { id: "ak", label: "Akan" },
  { id: "am", label: "Amharic" },
  { id: "an", label: "Aragonese" },
  { id: "ar", label: "Arabic" },
  { id: "as", label: "Assamese" },
  { id: "av", label: "Avaric" },
  { id: "ay", label: "Aymara" },
  { id: "az", label: "Azerbaijani" },
  { id: "ba", label: "Bashkir" },
  { id: "be", label: "Belarusian" },
  { id: "bg", label: "Bulgarian" },
  { id: "bh", label: "Bihari" },
  { id: "bi", label: "Bislama" },
  { id: "bm", label: "Bambara" },
  { id: "bn", label: "Bengali" },
  { id: "bo", label: "Tibetan" },
  { id: "br", label: "Breton" },
  { id: "bs", label: "Bosnian" },
  { id: "ca", label: "Catalan" },
  { id: "ce", label: "Chechen" },
  { id: "ch", label: "Chamorro" },
  { id: "co", label: "Corsican" },
  { id: "cr", label: "Cree" },
  { id: "cs", label: "Czech" },
  { id: "cu", label: "Church Slavic" },
  { id: "cv", label: "Chuvash" },
  { id: "cy", label: "Welsh" },
  { id: "da", label: "Danish" },
  { id: "de", label: "German" },
  { id: "dv", label: "Divehi" },
  { id: "dz", label: "Dzongkha" },
  { id: "ee", label: "Ewe" },
  { id: "el", label: "Greek" },
  { id: "eo", label: "Esperanto" },
  { id: "es", label: "Spanish" },
  { id: "et", label: "Estonian" },
  { id: "eu", label: "Basque" },
  { id: "fa", label: "Persian" },
  { id: "ff", label: "Fulah" },
  { id: "fi", label: "Finnish" },
  { id: "fj", label: "Fijian" },
  { id: "fo", label: "Faroese" },
  { id: "fr", label: "French" },
  { id: "fy", label: "Western Frisian" },
  { id: "ga", label: "Irish" },
  { id: "gd", label: "Scottish Gaelic" },
  { id: "gl", label: "Galician" },
  { id: "gn", label: "Guarani" },
  { id: "gu", label: "Gujarati" },
  { id: "gv", label: "Manx" },
  { id: "ha", label: "Hausa" },
  { id: "he", label: "Hebrew" },
  { id: "hi", label: "Hindi" },
  { id: "ho", label: "Hiri Motu" },
  { id: "hr", label: "Croatian" },
  { id: "ht", label: "Haitian Creole" },
  { id: "hu", label: "Hungarian" },
  { id: "hy", label: "Armenian" },
  { id: "hz", label: "Herero" },
  { id: "ia", label: "Interlingua" },
  { id: "id", label: "Indonesian" },
  { id: "ie", label: "Interlingue" },
  { id: "ig", label: "Igbo" },
  { id: "ii", label: "Sichuan Yi" },
  { id: "ik", label: "Inupiaq" },
  { id: "io", label: "Ido" },
  { id: "is", label: "Icelandic" },
  { id: "it", label: "Italian" },
  { id: "iu", label: "Inuktitut" },
  { id: "ja", label: "Japanese" },
  { id: "jv", label: "Javanese" },
  { id: "ka", label: "Georgian" },
  { id: "kg", label: "Kongo" },
  { id: "ki", label: "Kikuyu" },
  { id: "kj", label: "Kuanyama" },
  { id: "kk", label: "Kazakh" },
  { id: "kl", label: "Kalaallisut" },
  { id: "km", label: "Khmer" },
  { id: "kn", label: "Kannada" },
  { id: "ko", label: "Korean" },
  { id: "kr", label: "Kanuri" },
  { id: "ks", label: "Kashmiri" },
  { id: "ku", label: "Kurdish" },
  { id: "kv", label: "Komi" },
  { id: "kw", label: "Cornish" },
  { id: "ky", label: "Kyrgyz" },
  { id: "la", label: "Latin" },
  { id: "lb", label: "Luxembourgish" },
  { id: "lg", label: "Ganda" },
  { id: "li", label: "Limburgish" },
  { id: "ln", label: "Lingala" },
  { id: "lo", label: "Lao" },
  { id: "lt", label: "Lithuanian" },
  { id: "lu", label: "Luba-Katanga" },
  { id: "lv", label: "Latvian" },
  { id: "mg", label: "Malagasy" },
  { id: "mh", label: "Marshallese" },
  { id: "mi", label: "Maori" },
  { id: "mk", label: "Macedonian" },
  { id: "ml", label: "Malayalam" },
  { id: "mn", label: "Mongolian" },
  { id: "mr", label: "Marathi" },
  { id: "ms", label: "Malay" },
  { id: "mt", label: "Maltese" },
  { id: "my", label: "Burmese" },
  { id: "na", label: "Nauru" },
  { id: "nb", label: "Norwegian Bokmal" },
  { id: "nd", label: "North Ndebele" },
  { id: "ne", label: "Nepali" },
  { id: "ng", label: "Ndonga" },
  { id: "nl", label: "Dutch" },
  { id: "nn", label: "Norwegian Nynorsk" },
  { id: "no", label: "Norwegian" },
  { id: "nr", label: "South Ndebele" },
  { id: "nv", label: "Navajo" },
  { id: "ny", label: "Chichewa" },
  { id: "oc", label: "Occitan" },
  { id: "oj", label: "Ojibwa" },
  { id: "om", label: "Oromo" },
  { id: "or", label: "Odia" },
  { id: "os", label: "Ossetian" },
  { id: "pa", label: "Punjabi" },
  { id: "pi", label: "Pali" },
  { id: "pl", label: "Polish" },
  { id: "ps", label: "Pashto" },
  { id: "pt", label: "Portuguese" },
  { id: "qu", label: "Quechua" },
  { id: "rm", label: "Romansh" },
  { id: "rn", label: "Rundi" },
  { id: "ro", label: "Romanian" },
  { id: "ru", label: "Russian" },
  { id: "rw", label: "Kinyarwanda" },
  { id: "sa", label: "Sanskrit" },
  { id: "sc", label: "Sardinian" },
  { id: "sd", label: "Sindhi" },
  { id: "se", label: "Northern Sami" },
  { id: "sg", label: "Sango" },
  { id: "si", label: "Sinhala" },
  { id: "sk", label: "Slovak" },
  { id: "sl", label: "Slovenian" },
  { id: "sm", label: "Samoan" },
  { id: "sn", label: "Shona" },
  { id: "so", label: "Somali" },
  { id: "sq", label: "Albanian" },
  { id: "sr", label: "Serbian" },
  { id: "ss", label: "Swati" },
  { id: "st", label: "Southern Sotho" },
  { id: "su", label: "Sundanese" },
  { id: "sv", label: "Swedish" },
  { id: "sw", label: "Swahili" },
  { id: "ta", label: "Tamil" },
  { id: "te", label: "Telugu" },
  { id: "tg", label: "Tajik" },
  { id: "th", label: "Thai" },
  { id: "ti", label: "Tigrinya" },
  { id: "tk", label: "Turkmen" },
  { id: "tl", label: "Tagalog" },
  { id: "tn", label: "Tswana" },
  { id: "to", label: "Tongan" },
  { id: "tr", label: "Turkish" },
  { id: "ts", label: "Tsonga" },
  { id: "tt", label: "Tatar" },
  { id: "tw", label: "Twi" },
  { id: "ty", label: "Tahitian" },
  { id: "ug", label: "Uyghur" },
  { id: "uk", label: "Ukrainian" },
  { id: "ur", label: "Urdu" },
  { id: "uz", label: "Uzbek" },
  { id: "ve", label: "Venda" },
  { id: "vi", label: "Vietnamese" },
  { id: "vo", label: "Volapuk" },
  { id: "wa", label: "Walloon" },
  { id: "wo", label: "Wolof" },
  { id: "xh", label: "Xhosa" },
  { id: "yi", label: "Yiddish" },
  { id: "yo", label: "Yoruba" },
  { id: "za", label: "Zhuang" },
  { id: "zh", label: "Chinese" },
  { id: "zu", label: "Zulu" },
] as const;

const PREVIEW: Record<string, Record<string, string>> = {
  hello: { es: "hola", fr: "bonjour", de: "hallo", pt: "olá", zh: "你好" },
  "what time is it?": { es: "¿Qué hora es?", fr: "Quelle heure est-il ?", de: "Wie spät ist es?", pt: "Que horas são?", zh: "现在几点？" },
};

export function voiceHostAllowed(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "translate.google.com" || host.endsWith(".google.com") || host.endsWith(".googleapis.com") || host.endsWith(".gstatic.com")) return false;
  return host.length > 0;
}

export type VoiceTranslation = {
  engine: "sokuji";
  model: "opus-mt";
  source: string;
  modelSource: string;
  weightsLoaded: boolean;
  google: false;
  target: string;
  text: string | null;
  note: string;
  pair?: string;
};

export function translateVoice(text: string, target = "es", fetchImpl: typeof fetch = fetch) {
  return translateWithOpus(text, target, fetchImpl);
}

export async function translateWithOpus(
  text: string,
  target = "es",
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceTranslation> {
  const base = {
    engine: "sokuji" as const,
    model: "opus-mt" as const,
    source: SOKUJI_SOURCE,
    modelSource: OPUS_MT_SOURCE,
    google: false as const,
    target,
  };
  const spoken = text.trim();
  if (!spoken) {
    return { ...base, weightsLoaded: false, text: null, note: "Nothing to translate. Nothing was sent to Google." };
  }
  try {
    const response = await fetchImpl(OPUS_MT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: spoken, target }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json() as {
      ok?: boolean;
      text?: string;
      note?: string;
      pair?: string;
      weightsLoaded?: boolean;
      error?: string;
    };
    const translated = body.text?.trim() ?? "";
    if (response.ok && body.ok && body.weightsLoaded && translated) {
      return {
        ...base,
        weightsLoaded: true,
        text: translated,
        pair: body.pair,
        note: body.note || "Translated by Opus-MT. Nothing was sent to Google.",
      };
    }
    return {
      ...base,
      weightsLoaded: false,
      text: null,
      pair: body.pair,
      note: body.error || "Opus-MT weights are not loaded on this machine. Nothing was sent to Google.",
    };
  } catch {
    return {
      ...base,
      weightsLoaded: false,
      text: null,
      note: "Opus-MT is not running on this machine. Nothing was sent to Google.",
    };
  }
}

export function previewPhrase(text: string, target = "es") {
  const key = text.trim().toLowerCase();
  const preview = PREVIEW[key]?.[target] ?? null;
  return {
    engine: "sokuji" as const,
    model: "opus-mt" as const,
    source: SOKUJI_SOURCE,
    modelSource: OPUS_MT_SOURCE,
    weightsLoaded: false as const,
    google: false as const,
    target,
    text: preview,
    note: preview
      ? "Test phrase only. Opus-MT weights are not loaded. Nothing was sent to Google."
      : "Opus-MT weights are not loaded on this machine. Nothing was sent to Google.",
  };
}
