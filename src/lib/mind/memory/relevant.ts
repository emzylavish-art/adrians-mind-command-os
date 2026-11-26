

const EQUIVALENTS: Record<string, string> = { costs: "cost", price: "cost", pricing: "cost", expense: "cost", expenses: "cost", budget: "cost", deadlines: "deadline", due: "deadline", tasks: "task", projects: "project", preferences: "preference", preferred: "preference" };
function terms(text: string) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).map((word) => EQUIVALENTS[word] ?? word));
}
export type RetrievalNote = { id: string; text: string; archived?: boolean; alwaysApply?: boolean; updatedAt?: string; authority?: "owner-approved" | "unreviewed" | "historical"; supersedesIds?: string[]; source?: string; sourceRef?: { documentId?: string; section?: string; url?: string; quote?: string } };

const STOP_WORDS = new Set("a an and are as at be been but by can could did do does for from had has have how i if in information into is it its me more my of on or our please should some that the their them there these they this to use used using was we were what when where which with would you your about explain details current latest help need want tell something".split(" "));
// Local, inspectable vocabulary expansion. This is not an embedding service or a claim of general semantic understanding.
const CONCEPTS = [
  ["delete", "deleted", "deletion", "remove", "removed", "removal", "erase"],
  ["permission", "permissions", "authorization", "authorisation", "grant", "scope", "access"],
  ["restart", "restarted", "resume", "reopen", "relaunch"],
  ["persistent", "persistence", "durable", "durability", "storage", "persist"],
  ["disconnect", "disconnected", "revoke", "revoked", "revocation"],
  ["cost", "price", "pricing", "budget", "spend", "expense"],
  ["error", "failure", "failed", "bug", "fault"],
  ["automobile", "car", "vehicle"],
  ["backup", "recovery", "restore", "restoration"],
  ["colour", "color"],
  ["deploy", "deployment", "release", "publish"],
  ["sign-in", "signin", "login", "authentication", "authenticate"],
];
const conceptFor = new Map(CONCEPTS.flatMap((group, index) => group.map((word) => [word, `concept:${index}`] as const)));
function stem(word: string) { return word.length > 5 ? word.replace(/(?:ing|ed|es|s)$/u, "") : word; }
export function retrievalTerms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_:/.-]*/gu) ?? []).filter((word) => word.length >= 2 && !STOP_WORDS.has(word)).flatMap((word) => {
    const split = word.split(/[_:/.-]+/u).filter((part) => part.length >= 2 && !STOP_WORDS.has(part));
    return [...new Set([word, ...split].flatMap((part) => [part, stem(part), ...(conceptFor.has(part) ? [conceptFor.get(part)!] : [])]))];
  }));
}

/** Preserve ordinary preferences as fallback; move lexical evidence ahead of unrelated notes. */
export function rankMemories<T extends RetrievalNote>(items: T[], query: string) {
  const words = retrievalTerms(query);
  const identifiers = new Set((query.match(/\b[A-Z]{2,8}\b|\b[\p{L}\p{N}]*\d[\p{L}\p{N}_:/.-]*\b|\b[\p{L}\p{N}]+(?:[_:/.-][\p{L}\p{N}]+)+\b/gu) ?? []).map((word) => word.toLowerCase()));
  const eligible = items.filter((item) => !item.archived);
  const indexed = eligible.map((item) => ({ item, terms: retrievalTerms(item.text) }));
  const frequency = new Map<string, number>();
  for (const { terms } of indexed) for (const term of terms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const superseded = new Set(eligible.filter((item) => item.authority === "owner-approved").flatMap((item) => item.supersedesIds ?? []));
  return indexed.map(({ item, terms }) => {
    let score = 0;
    const matches: string[] = [];
    for (const word of words) if (terms.has(word)) {
      score += (1 + Math.log(1 + indexed.length / (frequency.get(word) ?? 1))) * (identifiers.has(word) ? 5 : word.startsWith("concept:") ? 0.45 : 1);
      matches.push(word);
    }
    if (score > 0 && item.authority === "owner-approved") score *= 1.15;
    if (item.authority === "historical" || superseded.has(item.id)) score *= 0.35;
    return { item, score, matches, superseded: superseded.has(item.id) };
  }).sort((a, b) => b.score - a.score || (Date.parse(b.item.updatedAt ?? "") || 0) - (Date.parse(a.item.updatedAt ?? "") || 0) || a.item.id.localeCompare(b.item.id));
}

export type MemorySelectionReceipt = { method: "local-lexical-concepts"; candidateCount: number; includedIds: string[]; excluded: { id: string; reason: "archived" | "not-relevant" | "preference-budget" | "evidence-budget" | "superseded" }[]; characters: number; characterBudget: number; preferenceCharacters: number; evidenceCharacters: number };

/** Separate byte budgets prevent always-apply preferences from starving relevant evidence. Input must already be owner/project/chat scoped. */
export function selectMemoryContext<T extends RetrievalNote>(items: T[], query: string, options: { maxNotes?: number; maxChars?: number; preferenceChars?: number } = {}): { notes: T[]; receipt: MemorySelectionReceipt } {
  const maxNotes = Math.max(1, Math.min(64, options.maxNotes ?? 32));
  const maxChars = Math.max(256, Math.min(32000, options.maxChars ?? 12000));
  const preferenceBudget = Math.min(Math.max(128, options.preferenceChars ?? 4000), maxChars);
  const ranked = rankMemories(items, query);
  const preferences = ranked.filter(({ item, superseded }) => item.alwaysApply && !superseded);
  const relevant = ranked.filter(({ item, score, superseded }) => !item.alwaysApply && score > 0 && !superseded);
  const chosen = new Set<string>();
  let preferenceCharacters = 0;
  let evidenceCharacters = 0;
  const notes: T[] = [];
  // Reserve at least one slot and its text budget for task evidence if it exists.
  for (const { item } of preferences) {
    if (notes.length >= maxNotes - (relevant.length ? 1 : 0) || preferenceCharacters + item.text.length > preferenceBudget) continue;
    notes.push(item); chosen.add(item.id); preferenceCharacters += item.text.length;
  }
  for (const { item } of relevant) {
    if (notes.length >= maxNotes || preferenceCharacters + evidenceCharacters + item.text.length > maxChars) continue;
    notes.push(item); chosen.add(item.id); evidenceCharacters += item.text.length;
  }
  // If no evidence needed the unused evidence budget can retain further owner preferences.
  if (!relevant.length) for (const { item } of preferences) {
    if (chosen.has(item.id) || notes.length >= maxNotes || preferenceCharacters + item.text.length > maxChars) continue;
    notes.push(item); chosen.add(item.id); preferenceCharacters += item.text.length;
  }
  const scored = new Map(ranked.map((entry) => [entry.item.id, entry]));
  const excluded: MemorySelectionReceipt["excluded"] = items.filter((item) => !chosen.has(item.id)).map((item) => ({ id: item.id, reason: item.archived ? "archived" : scored.get(item.id)?.superseded ? "superseded" : item.alwaysApply ? "preference-budget" : (scored.get(item.id)?.score ?? 0) <= 0 ? "not-relevant" : "evidence-budget" }));
  return { notes, receipt: { method: "local-lexical-concepts", candidateCount: items.length, includedIds: notes.map((item) => item.id), excluded, characters: preferenceCharacters + evidenceCharacters, characterBudget: maxChars, preferenceCharacters, evidenceCharacters } };
}

export function relevantMemories<T extends RetrievalNote>(items: T[], query: string) {
  return selectMemoryContext(items, query).notes;
}

export function voiceProviderStatus(voiceKey: string | undefined) {
  return {
    realtime: false as const,
    input: "Browser speech recognition, when the browser has it. This is not a realtime voice session.",
    output: voiceKey ? "A speech key is set. This check did not play audio." : "No speech key is configured. Nothing is spoken.",
  };
}

export function safeToResume(entries: { action: string; target: string; at: string; result: string }[], toolId: string, at: string) {
  return !entries.some((entry) => entry.action === "agent_turn" && entry.target === toolId && entry.at >= at && entry.result.includes("completed"));
}
