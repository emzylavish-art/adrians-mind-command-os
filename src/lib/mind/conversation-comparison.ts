import { writeShareSearch } from "./app-location.ts";
import type { Chat } from "./types.ts";

export const MAX_COMPARISON_CHATS = 6;
export const MAX_COMPARISON_PASSAGES = 120;
export type ComparisonProof = "unreviewed" | "confirmed" | "proposal" | "hypothesis";
export type ComparisonPassage = {
  id: string;
  chatId: string;
  chatTitle: string;
  messageId: string;
  messageAt: string;
  provider?: string;
  model?: string;
  replyVersionId?: string;
  start: number;
  end: number;
  text: string;
};
export type ComparisonReview = {
  source: ComparisonPassage;
  included: boolean;
  proof: ComparisonProof;
  evidence: string;
  verificationNeeded: string;
  /** Owner-assigned decision topic and position; different positions are unresolved disagreements. */
  topic: string;
  position: string;
};
export type ComparisonBlueprint = {
  reviews: ComparisonReview[];
  duplicates: { text: string; passageIds: string[] }[];
  disagreements: { topic: string; positions: { position: string; passageIds: string[] }[] }[];
  outstanding: { passageId: string; reason: string }[];
  markdown: string;
};

/** Extract source ranges only. Text is never promoted to a fact or automatically summarized. */
export function comparisonPassages(chats: readonly Chat[], selectedIds: readonly string[]): { ok: true; passages: ComparisonPassage[] } | { ok: false; error: string } {
  const ids = [...new Set(selectedIds)];
  if (ids.length < 2 || ids.length > MAX_COMPARISON_CHATS) return { ok: false, error: `Select between two and ${MAX_COMPARISON_CHATS} saved conversations.` };
  const selected = ids.map((id) => chats.find((chat) => chat.id === id && !chat.temporary));
  if (selected.some((chat) => !chat)) return { ok: false, error: "A selected conversation is unavailable or temporary. Review the selection again." };
  const passages: ComparisonPassage[] = [];
  for (const chat of selected as Chat[]) {
    for (const message of chat.messages) {
      if (message.role !== "assistant" || message.kind === "error" || message.delivery) continue;
      let cursor = 0;
      for (const block of message.content.split(/\n[ \t]*\n/)) {
        const found = message.content.indexOf(block, cursor);
        cursor = found + block.length;
        const text = block.trim();
        if (!text || /^#{1,6}\s+[^\n]+$/.test(text)) continue;
        const start = found + block.indexOf(text);
        const end = start + text.length;
        passages.push({ id: JSON.stringify([chat.id, message.id, message.selectedReplyVersionId ?? null, start, end]), chatId: chat.id, chatTitle: chat.title, messageId: message.id, messageAt: message.at, ...(message.provider ? { provider: message.provider } : {}), ...(message.model ? { model: message.model } : {}), ...(message.selectedReplyVersionId ? { replyVersionId: message.selectedReplyVersionId } : {}), start, end, text });
        if (passages.length > MAX_COMPARISON_PASSAGES) return { ok: false, error: `This selection contains more than ${MAX_COMPARISON_PASSAGES} passages. Choose fewer conversations; no passages were silently discarded.` };
      }
    }
  }
  if (!passages.length) return { ok: false, error: "The selected conversations have no completed assistant text to compare." };
  return { ok: true, passages };
}

export function newComparisonReview(source: ComparisonPassage): ComparisonReview {
  return { source, included: true, proof: "unreviewed", evidence: "", verificationNeeded: "", topic: "", position: "" };
}

export function comparisonSourceCurrent(chats: readonly Chat[], source: ComparisonPassage) {
  const chat = chats.find((item) => item.id === source.chatId && !item.temporary);
  const message = chat?.messages.find((item) => item.id === source.messageId && item.role === "assistant" && item.kind !== "error" && !item.delivery);
  return Boolean(message && message.selectedReplyVersionId === source.replyVersionId && message.at === source.messageAt && message.provider === source.provider && message.model === source.model && Number.isInteger(source.start) && Number.isInteger(source.end) && source.start >= 0 && source.end > source.start && message.content.slice(source.start, source.end) === source.text);
}

function sourceLabel(source: ComparisonPassage) {
  const label = source.chatTitle.replace(/[[\]\n]/g, " ");
  const link = writeShareSearch("", { section: "chat", chat: source.chatId, project: null, file: null, bot: null }, ["chat"]);
  return `[${label}](${link}) · chat ${source.chatId} · message ${source.messageId}${source.replyVersionId ? ` · answer version ${source.replyVersionId}` : ""} · characters ${source.start}–${source.end} · ${source.messageAt} · ${[source.provider, source.model].filter(Boolean).join(" / ") || "provider unreported"}`;
}

/** Owner-reviewed comparison. Duplicate text is grouped; disagreements are explicit owner positions, never guessed consensus. */
export function consolidateInvestigations(chats: readonly Chat[], reviews: readonly ComparisonReview[]): { ok: true; blueprint: ComparisonBlueprint } | { ok: false; error: string } {
  const included = reviews.filter((review) => review.included);
  if (!included.length || included.length > MAX_COMPARISON_PASSAGES) return { ok: false, error: "Select between one and 120 source passages for the blueprint." };
  if (new Set(included.map((review) => review.source.chatId)).size < 2) return { ok: false, error: "Keep at least one passage from each of two conversations for comparison." };
  if (included.some((review) => !comparisonSourceCurrent(chats, review.source))) return { ok: false, error: "A source conversation, answer version or passage changed. Rebuild the review before exporting; no stale finding was silently copied." };
  if (included.some((review) => review.proof === "confirmed" && !review.evidence.trim())) return { ok: false, error: "Every owner-confirmed finding needs an evidence note. Leave unsupported claims unreviewed, hypothetical or proposed." };
  const duplicatesByText = new Map<string, ComparisonReview[]>();
  const decisions = new Map<string, { label: string; positions: Map<string, { label: string; ids: string[] }> }>();
  for (const review of included) {
    const key = review.source.text;
    duplicatesByText.set(key, [...(duplicatesByText.get(key) ?? []), review]);
    const topic = review.topic.trim(); const position = review.position.trim();
    if (!topic || !position) continue;
    const decision = decisions.get(topic.toLowerCase()) ?? { label: topic, positions: new Map() };
    const stance = decision.positions.get(position.toLowerCase()) ?? { label: position, ids: [] };
    stance.ids.push(review.source.id); decision.positions.set(position.toLowerCase(), stance); decisions.set(topic.toLowerCase(), decision);
  }
  const duplicates = [...duplicatesByText].filter(([, rows]) => rows.length > 1).map(([text, rows]) => ({ text, passageIds: rows.map((row) => row.source.id) }));
  const disagreements = [...decisions.values()].filter((item) => item.positions.size > 1).map((item) => ({ topic: item.label, positions: [...item.positions.values()].map((position) => ({ position: position.label, passageIds: position.ids })) }));
  const outstanding = included.flatMap((review) => review.verificationNeeded.trim() || review.proof === "unreviewed" || review.proof === "hypothesis" ? [{ passageId: review.source.id, reason: review.verificationNeeded.trim() || "Verify the source claim before treating it as established." }] : []);
  const number = new Map(included.map((review, index) => [review.source.id, index + 1]));
  const sections = ["# Investigation comparison blueprint", "This is an owner-reviewed compilation of source passages. Confirmed labels reflect the owner's evidence notes; this workflow makes no independent verification or provider call. Conflicts remain unresolved until the owner chooses a disposition."];
  for (const [proof, title] of [["confirmed", "Owner-confirmed findings with evidence"], ["proposal", "Proposals"], ["hypothesis", "Hypotheses"], ["unreviewed", "Unreviewed source claims"]] as const) {
    const rows = included.filter((review) => review.proof === proof);
    if (!rows.length) continue;
    sections.push(`## ${title}`);
    for (const row of rows) sections.push(`### Finding ${number.get(row.source.id)}\n\n${row.source.text}\n\nSource: ${sourceLabel(row.source)}\n\n${row.evidence.trim() ? `Evidence supplied by owner: ${row.evidence.trim()}` : "Evidence: not supplied."}${row.topic.trim() ? `\n\nDecision topic: ${row.topic.trim()}${row.position.trim() ? ` · position: ${row.position.trim()}` : ""}` : ""}`);
  }
  sections.push("## Duplicate passages", duplicates.length ? duplicates.map((group) => `- Findings ${group.passageIds.map((id) => number.get(id)).join(", ")} contain the same text. Every source remains attributed.`).join("\n") : "No exact-text duplicates among the selected passages. This does not establish semantic uniqueness.");
  sections.push("## Disagreements requiring a decision", disagreements.length ? disagreements.map((group) => `- ${group.topic}: ${group.positions.map((position) => `${position.position} (findings ${position.passageIds.map((id) => number.get(id)).join(", ")})`).join(" versus ")}. No position was selected automatically.`).join("\n") : "No differing owner-labelled positions were recorded. Review the sources for other contradictions; no semantic conflict detector ran.");
  sections.push("## Outstanding verification", outstanding.length ? outstanding.map((entry) => `- Finding ${number.get(entry.passageId)}: ${entry.reason}`).join("\n") : "No additional verification tasks were supplied. Owner-confirmed labels do not constitute a live acceptance-test result.");
  return { ok: true, blueprint: { reviews: included.map((review) => ({ ...review, source: { ...review.source } })), duplicates, disagreements, outstanding, markdown: sections.join("\n\n") + "\n" } };
}
