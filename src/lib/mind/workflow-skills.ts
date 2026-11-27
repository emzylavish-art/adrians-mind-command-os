import { effectiveContextPolicy } from "./memory/context-policy.ts";
import type { Chat, Msg } from "./types.ts";
import type { ContextReceipt } from "./conversation-context.ts";
import type { DraftContent } from "./skill-library.ts";

export const LEARN_WORKFLOWS_KEY = "amcos.learn-workflows.v1";

export function learningEnabled(storage: Pick<Storage, "getItem">) {
  try { return storage.getItem(LEARN_WORKFLOWS_KEY) !== "off"; }
  catch { return false; }
}

const procedures = {
  list_projects: ["Find a workspace project", "Locate a project in the current workspace.", "List the projects available to the current account. Compare their names with the requested project and ask for a choice if multiple entries match."],
  list_chats: ["Find a conversation", "Find the right conversation in a workspace.", "List conversations visible in the current workspace. Return the matching entries and let the user choose when several titles match."],
  search_notes: ["Find a saved note", "Retrieve relevant notes within the current conversation's memory permissions.", "Check the conversation's memory scope. Search accessible notes using the requested topic. Identify which retrieved notes support the answer."],
  list_schedules: ["Review scheduled work", "Summarize scheduled jobs and their next runs.", "Read the current schedule. Group jobs by enabled state and show the next scheduled run for each enabled job."],
  web_search: ["Research with source links", "Research a question and return the sources supporting the findings.", "Search for the current question. Inspect the returned citations, link each finding to its source, and identify remaining gaps."],
  notion_read: ["Find information in Notion", "Read relevant pages from the connected Notion workspace.", "Use the workspace selected for the current conversation. Resolve ambiguous page names, read the authorized result, and identify its source in the answer."],
  consulted_answer: ["Compare specialist answers", "Synthesize a response after consulting additional models.", "Choose helpers for the question within the current account's model permissions and budget. Compare the answers actually received, resolve disagreements using evidence, and identify any remaining uncertainty."],
  compare_images: ["Compare image attachments", "Compare visual details across multiple images supplied in a conversation.", "Confirm which attachments were included in the model input. Compare the same feature across each image and flag areas that are illegible or out of frame."],
  inspect_image: ["Inspect an image attachment", "Inspect an image provided with a question.", "Confirm the image was included in the model input. Address the requested details and distinguish visible features from uncertain interpretations."],
  document_answer: ["Answer from project documents", "Use accessible document excerpts to answer a question about a project.", "Check which documents are available to this chat. Select the relevant excerpts, attribute factual claims to those excerpts, and flag any information the documents do not cover."],
  memory_answer: ["Answer using saved context", "Use authorized saved context to personalize a response.", "Check the conversation's current memory permissions. Retrieve relevant notes, distinguish them from the user's current request, and identify any missing context."],
} as const;

export type WorkflowKind = keyof typeof procedures;

export function workflowKind(value: unknown): WorkflowKind | undefined {
  return typeof value === "string" && Object.hasOwn(procedures, value) ? value as WorkflowKind : undefined;
}

export function captureWorkflow(chat: Pick<Chat, "memory" | "temporary" | "contextPolicy">, owner: string | null, kind: unknown, current = chat) {
  const permitsLearning = (state: typeof chat) => {
    const policy = effectiveContextPolicy(state);
    return policy.saveMemories && policy.history;
  };
  return owner && permitsLearning(chat) && permitsLearning(current) ? workflowKind(kind) : undefined;
}

export type LearnedWorkflow = { id: string; content: DraftContent; count: number; latest: string };

function observe(found: Map<string, LearnedWorkflow>, steps: WorkflowKind[], at: string) {
  const id = steps.join("-then-");
  const existing = found.get(id);
  if (existing) {
    existing.count++;
    if (at > existing.latest) existing.latest = at;
    return;
  }
  const title = steps.map(step => procedures[step][0]).join(" → ");
  const summary = steps.map(step => procedures[step][1]).join(" ");
  const body = steps.map((step, index) => steps.length === 1 ? procedures[step][2] : (index + 1) + ". " + procedures[step][2]).join("\n\n");
  found.set(id, { id, content: { title, summary, body }, count: 1, latest: at });
}

/** A projection of the owner's existing messages. No duplicate store of private chat data. */
export function learnedWorkflows(chats: readonly Chat[]): LearnedWorkflow[] {
  const single = new Map<string, LearnedWorkflow>();
  const sequences = new Map<string, LearnedWorkflow>();
  const seen = new Set<string>();
  for (const chat of chats) {
    const policy = effectiveContextPolicy(chat);
    if (!policy.saveMemories || !policy.history) continue;
    let prior: { kind: WorkflowKind; at: number } | undefined;
    for (const msg of chat.messages) {
      if (msg.role !== "assistant") continue;
      const kind = workflowKind(msg.workflowKind);
      const at = Date.parse(msg.at);
      if (!kind || !Number.isFinite(at) || msg.kind === "error" || msg.inheritedFrom || seen.has(msg.id)) {
        prior = undefined;
        continue;
      }
      seen.add(msg.id);
      observe(single, [kind], msg.at);
      // Only promote a sequence when two different adjacent steps recur in the same order.
      if (prior && prior.kind !== kind && at >= prior.at && at - prior.at <= 20 * 60_000) {
        observe(sequences, [prior.kind, kind], msg.at);
      }
      prior = { kind, at };
    }
  }
  return [...single.values(), ...[...sequences.values()].filter(row => row.count >= 2)]
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.id.localeCompare(b.id));
}

export function replyWorkflow(result: { consultation?: Msg["consultation"]; usedIds: string[]; contextReceipt?: ContextReceipt }): WorkflowKind | undefined {
  if (result.consultation?.some(helper => helper.ok && helper.dispatched !== false && helper.text.trim())) return "consulted_answer";
  const images = result.contextReceipt?.images.filter(image => image.included).length ?? 0;
  if (images >= 2) return "compare_images";
  if (images === 1) return "inspect_image";
  if (result.contextReceipt?.knowledge?.length) return "document_answer";
  if (result.usedIds.length) return "memory_answer";
  return undefined;
}

export function workflowMarkdown(workflow: LearnedWorkflow) {
  const { title, summary, body } = workflow.content;
  return ['---', 'name: ' + workflow.id.replaceAll('_', '-'), 'description: ' + JSON.stringify(summary), '---', '', '# ' + title, '', body, ''].join('\n');
}
