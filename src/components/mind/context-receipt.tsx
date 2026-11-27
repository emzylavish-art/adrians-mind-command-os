import type { ContextReceipt as Receipt } from "@/lib/mind/conversation-context";
import type { MemorySelectionReceipt } from "@/lib/mind/memory/relevant";

export function ContextReceiptDetails({ receipt, onOpenMessage }: { receipt: Receipt; onOpenMessage?: (id: string) => void }) {
  const included = receipt.history.filter((item) => item.state === "included").length;
  const excerpts = receipt.history.filter((item) => item.state === "excerpted").length;
  const omitted = receipt.history.filter((item) => item.state === "omitted");
  return <details className="text-xs rounded-lg border border-white/10 p-3 space-y-2"><summary className="cursor-pointer">Context used · {included} full messages · {excerpts} excerpts · {omitted.length} omitted</summary>
    <p className="text-muted-foreground mt-2">Local extractive selection. Text estimate {receipt.estimatedTextTokens.toLocaleString()} / {receipt.inputTokenBudget.toLocaleString()} budget; {receipt.outputTokenReserve.toLocaleString()} reserved for the answer. {receipt.capacity === "declared" ? "A declared model context limit was used." : "The model's exact window was unavailable, so a conservative application budget was used."} This UTF-8 byte upper bound is not tokenizer or billed usage. Image token use is provider dependent.</p>
    <p>Memory notes included: {receipt.memory?.includedIds.join(", ") || "none"}. {receipt.memory?.omittedIds.length ? `Omitted: ${receipt.memory.omittedIds.join(", ")}.` : ""} Project instructions: {receipt.projectInstructions ?? "absent"}.</p>
    <ul className="space-y-1 max-h-48 overflow-auto">{receipt.history.filter((item) => item.state !== "included").map((item) => <li key={item.id}>{onOpenMessage ? <button type="button" className="underline" onClick={() => onOpenMessage(item.id)}>{item.id}</button> : item.id}: {item.state}{item.reason ? ` (${item.reason})` : ""}{item.ranges?.length ? `; original ranges ${item.ranges.map((range) => `${range.start}–${range.end}`).join(", ")}` : ""}</li>)}</ul>
    {!!receipt.images.length && <ul>{receipt.images.map((item, index) => <li key={`${item.messageId}:${index}`}>{item.name}: {item.included ? "included" : `omitted (${item.reason})`}</li>)}</ul>}
    {!!receipt.checkpoints.length && <ul>{receipt.checkpoints.map((item) => <li key={item.id}>{item.kind} · {item.state} · {item.included ? "included" : "omitted"} · sources {item.sourceMessageIds.join(", ")}</li>)}</ul>}
    {!!receipt.knowledge?.length && <details><summary>Knowledge passages used</summary>{receipt.knowledge.map((item, index) => <blockquote key={`${item.documentId}:${index}`} className="border-l border-white/20 pl-2 my-2"><p>{item.documentId}, characters {item.start}–{item.end}</p><p className="whitespace-pre-wrap">{item.quote}</p></blockquote>)}</details>}
  </details>;
}

export function MemorySelectionDetails({ receipt }: { receipt: MemorySelectionReceipt }) {
  return <details className="text-xs text-muted-foreground"><summary>Memory selection · {receipt.includedIds.length} of {receipt.candidateCount} notes</summary><p>{receipt.characters.toLocaleString()} / {receipt.characterBudget.toLocaleString()} characters. Owner preferences: {receipt.preferenceCharacters.toLocaleString()}; task evidence: {receipt.evidenceCharacters.toLocaleString()}. Local keyword, identifier and concept matching; no embedding call.</p><ul>{receipt.excluded.map((item) => <li key={item.id}>{item.id}: {item.reason}</li>)}</ul></details>;
}
