import type { HonestFailureKind } from './failure-states.ts';

export const FAILURE_SUBSYSTEMS = ['chat', 'notion', 'mcp', 'research', 'image', 'video', 'voice', 'storage', 'build', 'auth', 'pc', 'fleet', 'connectors', 'unknown'] as const;
export type FailureSubsystem = typeof FAILURE_SUBSYSTEMS[number];
export type FailureStage = 'preflight' | 'authenticate' | 'prepare' | 'dispatch' | 'response' | 'verify' | 'persist' | 'unknown';
export type FailureRetryPolicy = 'never' | 'retry-read' | 'replay-receipt' | 'review' | 'reauthenticate' | 'repair-permissions' | 'wait';
export type OutcomeCertainty = 'not_dispatched' | 'unknown' | 'failed' | 'completed' | 'partial';
export type FailureOperationKind = 'read' | 'write' | 'generation' | 'local' | 'unknown';
export type FailureEnvelope = {
  version: 1; code: string; subsystem: FailureSubsystem; operationId: string | null;
  provider: string | null; stage: FailureStage; retryPolicy: FailureRetryPolicy;
  outcome: OutcomeCertainty; operationKind: FailureOperationKind; message: string;
  httpStatus?: number; retryAfterAt?: string;
};
export type FailureDetails = Partial<Omit<FailureEnvelope, 'version' | 'message'>> & { envelope?: FailureEnvelope };
const stages = ['preflight','authenticate','prepare','dispatch','response','verify','persist','unknown'];
const retries = ['never','retry-read','replay-receipt','review','reauthenticate','repair-permissions','wait'];
const outcomes = ['not_dispatched','unknown','failed','completed','partial'];
const operationKinds = ['read','write','generation','local','unknown'];
const own = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown, max=160): string | null => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/.test(value) ? value : null;
const safeCode = (value: unknown) => typeof value === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(value) ? value : 'operation_failed';

/** No prompts, credential material, callbacks or old approvals belong in this envelope. */
export function createFailureEnvelope(input: Omit<FailureEnvelope, 'version'>): FailureEnvelope {
  const retryAfterAt = typeof input.retryAfterAt === 'string' && Number.isFinite(Date.parse(input.retryAfterAt)) ? new Date(input.retryAfterAt).toISOString() : undefined;
  return {
    version: 1, code: safeCode(input.code), subsystem: FAILURE_SUBSYSTEMS.includes(input.subsystem) ? input.subsystem : 'unknown',
    operationId: identifier(input.operationId), provider: identifier(input.provider, 80),
    stage: stages.includes(input.stage) ? input.stage : 'unknown',
    retryPolicy: retries.includes(input.retryPolicy) ? input.retryPolicy : 'review',
    outcome: outcomes.includes(input.outcome) ? input.outcome : 'unknown',
    operationKind: operationKinds.includes(input.operationKind) ? input.operationKind : 'unknown',
    message: typeof input.message === 'string' ? input.message.slice(0, 2000) : 'The operation did not complete.',
    ...(Number.isInteger(input.httpStatus) && input.httpStatus! >= 100 && input.httpStatus! <= 599 ? { httpStatus: input.httpStatus } : {}),
    ...(retryAfterAt ? { retryAfterAt } : {}),
  };
}
export function readFailureEnvelope(value: unknown): FailureEnvelope | null {
  if (!own(value) || value.version !== 1 || typeof value.code !== 'string' || safeCode(value.code) !== value.code || !FAILURE_SUBSYSTEMS.includes(value.subsystem as FailureSubsystem)
    || !stages.includes(value.stage as string) || !retries.includes(value.retryPolicy as string) || !outcomes.includes(value.outcome as string)
    || !operationKinds.includes(value.operationKind as string) || typeof value.message !== 'string') return null;
  return createFailureEnvelope(value as FailureEnvelope);
}
export function isFailureEnvelope(value: unknown): value is FailureEnvelope { return readFailureEnvelope(value) !== null; }

const knownKinds = new Set<HonestFailureKind>(['model_unavailable','database_write_failed','emergency_stop_active','mcp_tool_failed','chat_timeout','network_failure','auth_required','forbidden_cross_site','rate_limited','image_generation_failed','research_failed','notion_failed']);
const kindByCode: Record<string, HonestFailureKind> = {
  unauthenticated:'auth_required', unauthorized:'auth_required', session_expired:'auth_required', authentication_required:'auth_required',
  emergency_stop:'emergency_stop_active', provider_not_configured:'model_unavailable', provider_unavailable:'model_unavailable',
  request_timeout:'chat_timeout', request_isolation:'forbidden_cross_site', rate_limit:'rate_limited',
};
/** Structured classification never inspects the display message. */
export function classifyStructuredFailure(envelope: FailureEnvelope): HonestFailureKind | null {
  if (knownKinds.has(envelope.code as HonestFailureKind)) return envelope.code as HonestFailureKind;
  if (kindByCode[envelope.code]) return kindByCode[envelope.code];
  if (envelope.retryPolicy === 'reauthenticate') return 'auth_required';
  if (envelope.httpStatus === 429) return 'rate_limited';
  if (envelope.subsystem === 'storage') return 'database_write_failed';
  if (envelope.subsystem === 'notion') return 'notion_failed';
  if (envelope.subsystem === 'mcp') return 'mcp_tool_failed';
  if (envelope.subsystem === 'research') return 'research_failed';
  if (envelope.subsystem === 'image' || envelope.subsystem === 'video') return 'image_generation_failed';
  if (envelope.subsystem === 'auth') return 'auth_required';
  return null;
}
function subsystemForAction(action: string, target: string): FailureSubsystem {
  const value = `${action}:${target}`.toLowerCase();
  if (/notion/.test(value)) return 'notion';
  if (/mcp/.test(value)) return 'mcp';
  if (/research|^search:/.test(value) || target === 'search') return 'research';
  if (/video/.test(value)) return 'video';
  if (/imagine|image/.test(value)) return 'image';
  if (/voice|speak|dictation|transcri/.test(value)) return 'voice';
  if (/database|server-copy|workspace_sync|storage/.test(value)) return 'storage';
  if (/build|kimi/.test(value)) return 'build';
  if (/^pc[_:]|pairing/.test(value)) return 'pc';
  if (/supabase|sign_in|sign_out|auth/.test(value)) return 'auth';
  if (/fleet|agent/.test(value)) return 'fleet';
  if (/oauth|service_setup|connector/.test(value)) return 'connectors';
  if (/chat|model|provider/.test(value)) return 'chat';
  return 'unknown';
}
/** Compatibility boundary uses stable action/target identifiers, never wording. */
export function failureEnvelopeFromAction(input: { action: string; target: string; message: string } & FailureDetails): FailureEnvelope {
  const provided = readFailureEnvelope(input.envelope);
  if (provided) return createFailureEnvelope({ ...provided, operationId: provided.operationId ?? input.operationId ?? null, provider: provided.provider ?? input.provider ?? null });
  const subsystem = input.subsystem ?? subsystemForAction(input.action, input.target);
  const code = safeCode(input.code ?? input.action);
  const operationKind = input.operationKind ?? (/(?:status|list|search|read|probe)_failed$/.test(code) && subsystem !== 'research' ? 'read' : ['image','video','voice','research','chat'].includes(subsystem) ? 'generation' : ['save','remove','append','delete','write','mutation','approve','disconnect'].some(word => code.includes(word)) ? 'write' : 'unknown');
  const outcome = input.outcome ?? 'unknown';
  const retryPolicy = input.retryPolicy ?? (['auth_required','unauthenticated','session_expired'].includes(code) ? 'reauthenticate' : code === 'rate_limited' ? 'wait' : ['emergency_stop_active','emergency_stop','request_isolation','forbidden_cross_site'].includes(code) ? 'never' : operationKind === 'read' ? 'retry-read' : 'review');
  return createFailureEnvelope({ code, subsystem, operationId: input.operationId ?? null, provider: input.provider ?? null, stage: input.stage ?? 'unknown', retryPolicy, outcome, operationKind, message: input.message, httpStatus: input.httpStatus, retryAfterAt: input.retryAfterAt });
}

/** Preserve existing wire fields; append a stable envelope only on failures.
 * Unknown dispatch state remains unknown. HTTP errors never prove no remote effect. */
export function withFailureEnvelope(value: unknown, context: FailureDetails & { subsystem: FailureSubsystem; status?: number }): unknown {
  if (!own(value) || value.ok === true || (value.ok !== false && (typeof value.error !== 'string' || !value.error))) return value;
  if (readFailureEnvelope(value.failureEnvelope)) return value;
  const status = context.status ?? 200;
  const code = typeof value.code === 'string' ? value.code : status === 401 ? 'auth_required' : status === 429 ? 'rate_limited' : status === 403 ? 'request_forbidden' : status === 409 ? 'revision_conflict' : `${context.subsystem}_failed`;
  const policy = context.retryPolicy ?? (['emergency_stop','emergency_stop_active','request_isolation','forbidden_cross_site'].includes(code) ? 'never'
    : ['resource_policy','free_only','budget_exceeded','revision_conflict','outcome_unknown'].includes(code) ? 'review'
    : ['auth_required','unauthenticated','session_expired'].includes(code) || status === 401 ? 'reauthenticate'
    : code === 'permission_denied' ? 'repair-permissions' : status === 429 || code === 'rate_limited' ? 'wait' : 'review');
  const failureEnvelope = failureEnvelopeFromAction({ ...context, action: code, code, target: context.subsystem, message: typeof value.error === 'string' ? value.error : 'The operation did not complete.',
    operationId: context.operationId ?? identifier(value.operationId ?? value.requestId), provider: context.provider ?? identifier(value.provider,80),
    stage: context.stage ?? (status === 401 ? 'authenticate' : 'unknown'), retryPolicy: policy,
    outcome: context.outcome ?? (value.dispatched === false ? 'not_dispatched' : 'unknown'), httpStatus: status,
  });
  return { ...value, failureEnvelope };
}

/** Bridge Notion's already-structured operation evidence without parsing copy. */
export function notionFailureEnvelope(turn: { action: string; error: string; wrote: boolean; verified: boolean; failure?: { operation: string; httpStatus: number; code: string; kind: string; recovery: string } }, operationId: string | null = null): FailureEnvelope {
  const evidence=turn.failure, write=evidence?.operation==='append'||turn.action==='append';
  const certainty:OutcomeCertainty=turn.wrote?turn.verified?'completed':'partial':evidence?.httpStatus===0?'unknown':evidence?.httpStatus&&evidence.httpStatus<500?'failed':'unknown';
  return createFailureEnvelope({code:evidence?.kind==='authorization'?'auth_required':evidence?.kind==='permission'?'permission_denied':evidence?.httpStatus===429?'rate_limited':evidence?.code&&evidence.code!=='unknown'?evidence.code:'notion_failed',subsystem:'notion',operationId,provider:'notion',stage:turn.wrote?'verify':'response',retryPolicy:evidence?.kind==='authorization'?'reauthenticate':evidence?.kind==='permission'?'repair-permissions':write?'review':evidence?.httpStatus===429?'wait':'retry-read',outcome:certainty,operationKind:write?'write':'read',message:turn.error,httpStatus:evidence?.httpStatus});
}
