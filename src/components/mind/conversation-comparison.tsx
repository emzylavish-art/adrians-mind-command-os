import { useState } from "react";
import { comparisonPassages, comparisonSourceCurrent, consolidateInvestigations, MAX_COMPARISON_CHATS, newComparisonReview, type ComparisonBlueprint, type ComparisonProof, type ComparisonReview } from "@/lib/mind/conversation-comparison";
import type { Chat } from "@/lib/mind/types";

export function ConversationComparison({ chats, activeId, onOpen }: { chats: Chat[]; activeId?: string; onOpen: (chatId: string) => void }) {
  const available = chats.filter((chat) => !chat.temporary);
  const [selected, setSelected] = useState<string[]>(activeId && available.some((chat) => chat.id === activeId) ? [activeId] : []);
  const [reviews, setReviews] = useState<ComparisonReview[]>([]);
  const [blueprint, setBlueprint] = useState<ComparisonBlueprint | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const amend = (id: string, patch: Partial<Omit<ComparisonReview, "source">>) => {
    setReviews((current) => current.map((review) => review.source.id === id ? { ...review, ...patch } : review));
    setBlueprint(null); setNotice("");
  };
  const prepare = () => {
    const result = comparisonPassages(chats, selected);
    setError(result.ok ? "" : result.error); setNotice(""); setBlueprint(null);
    setReviews(result.ok ? result.passages.map(newComparisonReview) : []);
  };
  const compile = () => {
    const result = consolidateInvestigations(chats, reviews);
    if (!result.ok) { setError(result.error); setBlueprint(null); return null; }
    setError(""); setBlueprint(result.blueprint); return result.blueprint;
  };
  const download = () => {
    const current = compile(); if (!current) return;
    const url = URL.createObjectURL(new Blob([current.markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "investigation-comparison.md"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("The comparison document was prepared for download. Source conversations remain unchanged.");
  };
  return <details className="mx-4 mb-2 rounded-panel border border-line p-3 text-sm" data-testid="conversation-comparison">
    <summary className="min-h-11 cursor-pointer font-medium">Compare investigations</summary>
    <p className="mb-3 text-xs text-muted">Choose two to {MAX_COMPARISON_CHATS} saved conversations. Review their exact passages, evidence and competing recommendations, then export a blueprint. This review stays in this session until exported; it makes no provider call and does not change the source conversations.</p>
    <fieldset className="max-h-52 overflow-auto rounded-panel border border-line p-2" disabled={reviews.length > 0}><legend className="px-1 text-xs">Source conversations</legend>{available.map((chat) => <label key={chat.id} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(chat.id)} disabled={!selected.includes(chat.id) && selected.length >= MAX_COMPARISON_CHATS} onChange={(event) => setSelected((current) => event.target.checked ? [...current, chat.id] : current.filter((id) => id !== chat.id))} /><span>{chat.title}{chat.branchFrom ? " · edited branch" : ""}</span></label>)}{available.length < 2 && <p className="text-xs text-muted">Two saved conversations are needed. Temporary chats are excluded.</p>}</fieldset>
    {!reviews.length ? <button type="button" className="mt-2 min-h-11 rounded-panel border border-line px-3 text-xs" disabled={selected.length < 2} onClick={prepare}>Review source passages</button> : <><div className="my-2 flex flex-wrap gap-2"><button type="button" className="min-h-11 px-2 text-xs underline" onClick={() => { setReviews([]); setBlueprint(null); setError(""); setNotice(""); }}>Change sources and reset review</button><span className="self-center text-xs text-muted">{reviews.filter((review) => review.included).length} of {reviews.length} passages included</span></div>
      <p className="mb-2 text-xs text-muted">Exact duplicate text is grouped automatically. For competing recommendations, enter the same decision topic and different positions. Other contradictions require your review. A provider's confident wording is not verification.</p>
      <div className="max-h-[36rem] space-y-3 overflow-auto">{reviews.map((review, index) => <section key={review.source.id} className="rounded-panel border border-line p-3">
        <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={review.included} onChange={(event) => amend(review.source.id, { included: event.target.checked })} /><strong>Passage {index + 1} · {review.source.chatTitle}</strong></label>
        <p className="mb-1 break-all text-[11px] text-muted">Message {review.source.messageId} · characters {review.source.start}–{review.source.end}{review.source.replyVersionId ? ` · version ${review.source.replyVersionId}` : ""}</p>
        <blockquote className="max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-line pl-3 text-xs">{review.source.text}</blockquote>
        <button type="button" className="min-h-11 text-xs underline" onClick={() => comparisonSourceCurrent(chats, review.source) ? onOpen(review.source.chatId) : setError("This source changed. Rebuild the review before continuing.")}>Open source conversation</button>
        {review.included && <div className="grid gap-2 text-xs md:grid-cols-2"><label>Evidence status<select className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-2" value={review.proof} onChange={(event) => amend(review.source.id, { proof: event.target.value as ComparisonProof })}><option value="unreviewed">Unreviewed source claim</option><option value="confirmed">Owner-confirmed · evidence required</option><option value="proposal">Proposal</option><option value="hypothesis">Hypothesis</option></select></label><label>Evidence note<input className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-2" value={review.evidence} onChange={(event) => amend(review.source.id, { evidence: event.target.value })} placeholder="Source, revision or actual acceptance-test result" /></label><label>Decision topic<input className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-2" value={review.topic} onChange={(event) => amend(review.source.id, { topic: event.target.value })} placeholder="For example, release destination" /></label><label>Position on this topic<input className="mt-1 block min-h-11 w-full rounded-panel border border-line bg-bg px-2" value={review.position} onChange={(event) => amend(review.source.id, { position: event.target.value })} placeholder="Use distinct labels for conflicting choices" /></label><label className="md:col-span-2">Outstanding verification<textarea rows={2} className="mt-1 block w-full rounded-panel border border-line bg-bg p-2" value={review.verificationNeeded} onChange={(event) => amend(review.source.id, { verificationNeeded: event.target.value })} placeholder="What still needs checking before implementation or release?" /></label></div>}
      </section>)}</div>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={compile}>Prepare comparison blueprint</button><button type="button" className="min-h-11 rounded-panel border border-line px-3 text-xs" onClick={download}>Download reviewed blueprint</button></div>
    </>}
    {blueprint && <div className="mt-3 text-xs"><p role="status">{blueprint.reviews.length} attributed passages · {blueprint.duplicates.length} duplicate groups · {blueprint.disagreements.length} unresolved topics · {blueprint.outstanding.length} verification tasks</p><textarea aria-label="Comparison blueprint" readOnly value={blueprint.markdown} rows={16} className="mt-2 w-full rounded-panel border border-line bg-bg p-3 font-mono text-xs" /></div>}
    {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}{notice && <p className="mt-2 text-xs text-muted" role="status">{notice}</p>}
  </details>;
}
