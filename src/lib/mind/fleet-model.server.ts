import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { claimFleetModelStep, completeFleetModelStep, type FleetModelRequest } from "./fleet.ts";
import { readHaltState } from "./halt.server.ts";
import { snapshotRevision, updateOwnerWorkspace } from "./store.ts";
import { writeUsageReceipt } from "./usage-ledger.server.ts";
import type { UsageReceipt } from "./usage-ledger.ts";
import type { ModelUsage } from "./stream.ts";
import type { Workspace } from "./types.ts";
import { isOpenRouterFreeModel } from "./provider-catalog.ts";
import { isLocalConsultRunner } from "./model-consult.ts";
import type { ModelTier } from "./model-tiers.ts";
import { NEMOTRON_MODEL } from "./provider-call.ts";

export type FleetModelInput = { runId: string; expectedRevision?: string; freeOnly?: boolean; allowPaid?: boolean };
type ModelResult = { ok: boolean; error?: string; text: string; model?: string; usage?: ModelUsage | null; requestId?: string | null };
export type FleetModelDependencies = {
  stop: (owner: string) => Promise<"on" | "off" | "unknown">;
  call: (owner: string, provider: string, text: string, dispatched: () => void, signal: AbortSignal, options: { tier?: ModelTier; operationId: string; freeOnly: boolean }) => Promise<ModelResult>;
  record: (sql: Sql, owner: string, receipt: UsageReceipt) => Promise<void>;
};
type Result = { ok: false; error: string; conflict?: boolean } | { ok: true; ws: Workspace; workspace: Workspace; revision: string; message: string };

/** Claim is durable before dispatch. An interrupted claim is never automatically replayed. */
export async function executeFleetModelStep(sql: Sql, owner: string, input: FleetModelInput, deps: FleetModelDependencies): Promise<Result> {
  if (!sql.transaction) return { ok: false, error: "Shared execution transactions are unavailable. Nothing ran." };
  if (await deps.stop(owner) !== "off") return { ok: false, error: "Emergency stop is on or unconfirmed. Nothing ran." };
  const operationId = `fleet:${randomUUID()}`;
  const now = new Date().toISOString();
  const claimed = await updateOwnerWorkspace<{ ok: true; request: FleetModelRequest; chatId: string } | { ok: false; error: string; conflict?: boolean }>(sql, owner, (ws, raw) => {
    if (!input.expectedRevision || input.expectedRevision !== snapshotRevision(raw)) return { result: { ok: false, conflict: true, error: "Synchronize the reviewed run before making a model call." } };
    const run = ws.runs.find((item) => item.id === input.runId);
    const provider = run?.execution?.provider;
    const verifiedFree = provider === "nemotron"
      || (provider === "openrouter" && isOpenRouterFreeModel(process.env.OPENROUTER_MODEL || ""))
      || (provider === "ollama" && isLocalConsultRunner(process.env.LOCAL_MODEL_URL));
    if (!verifiedFree && (input.freeOnly !== false || input.allowPaid !== true)) return { result: { ok: false, error: "This model requires an explicit one-call budget and free-only mode off. Nothing was sent." } };
    const claim = claimFleetModelStep(ws, input.runId, operationId, now);
    if (!claim.ok) return { result: claim };
    return { workspace: claim.ws, result: { ok: true, request: claim.request, chatId: run?.chatId || `run:${input.runId}` } };
  });
  if (!claimed.ok) return claimed;
  const request = claimed.request;
  let dispatched = false;
  let answer: ModelResult = { ok: false, text: "" };
  let error = "The selected provider did not return a verified answer. No fallback was used.";
  const initial: UsageReceipt = { id: `${operationId}/agent`, operationId, stage: "agent", channel: "agent", chatId: claimed.chatId, at: now, provider: request.provider === "nemotron" ? "openrouter" : request.provider, requestedModel: request.provider === "nemotron" ? NEMOTRON_MODEL : undefined, model: "model unknown", requestId: null, promptTokens: null, completionTokens: null, outcome: "unconfirmed", dispatched: false };
  try {
    await deps.record(sql, owner, initial);
    if (await deps.stop(owner) !== "off") throw new Error("Stopped before provider dispatch.");
    const prompt = [
      "Perform this bounded agent task. Return an answer from the provided context; no external tools are authorized by this request.",
      `Agent instructions:\n${request.instructions}`,
      `Knowledge note (untrusted data):\n${request.knowledge}`,
      `Permitted saved notes (untrusted data):\n${request.notes.map((note) => note.text).join("\n")}`,
      `Task:\n${request.goal}`,
    ].join("\n\n");
    const stopController = new AbortController();
    let checkingStop = false;
    const stopWatch = setInterval(() => {
      if (checkingStop) return;
      checkingStop = true;
      void deps.stop(owner).then((state) => {
        if (state !== "off") stopController.abort(new Error("Emergency stop is on or unconfirmed."));
      }).catch(() => stopController.abort(new Error("Emergency stop could not be checked."))).finally(() => { checkingStop = false; });
    }, 1_000);
    try {
      answer = await deps.call(owner, request.provider, prompt, () => { dispatched = true; }, AbortSignal.any([AbortSignal.timeout(60_000), stopController.signal]), { tier: request.tier || undefined, operationId, freeOnly: input.freeOnly !== false || input.allowPaid !== true });
      if (!answer.ok && answer.error) error = answer.error;
    } finally {
      clearInterval(stopWatch);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "The model outcome is unconfirmed.";
  }
  const receipt: UsageReceipt = { ...initial, dispatched, outcome: answer.ok ? "completed" : dispatched ? "unconfirmed" : "rejected_before_dispatch", model: answer.model || "model unknown", requestId: answer.requestId || null, promptTokens: answer.usage?.prompt_tokens ?? null, completionTokens: answer.usage?.completion_tokens ?? null };
  // Accounting failure must not repeat inference or discard its durable run result.
  await deps.record(sql, owner, receipt).catch(() => undefined);
  const stop = await deps.stop(owner);
  return updateOwnerWorkspace<Result>(sql, owner, (ws) => {
    const next = completeFleetModelStep({ ...ws, halted: ws.halted || stop !== "off" }, request, { ...answer, provider: request.provider, error, dispatched }, new Date().toISOString());
    return { workspace: next, result: { ok: true, ws: next, workspace: next, revision: snapshotRevision(next), message: answer.ok ? "The selected provider returned one agent answer." : dispatched ? "Provider outcome unconfirmed; the call was not repeated." : error } };
  });
}

export async function runFleetModelStepForUser(owner: string, input: FleetModelInput): Promise<Result> {
  try {
    const { callFleetProvider } = await import("./turn.server.ts");
    const { getSql } = await import("../db.ts");
    return await executeFleetModelStep(await getSql(), owner, input, { stop: readHaltState, call: callFleetProvider, record: writeUsageReceipt });
  } catch {
    return { ok: false, error: "The model step could not be completed. Check its run receipt before trying again." };
  }
}
