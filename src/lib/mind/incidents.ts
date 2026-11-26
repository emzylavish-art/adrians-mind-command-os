import { createFailureEnvelope, failureEnvelopeFromAction, readFailureEnvelope, type FailureEnvelope } from './failure-envelope.ts';

export type RecoveryBindings = { chatId?: string; workspaceId?: string; pageId?: string; grantGeneration?: string; connectionId?: string; model?: string; projectId?: string; reportId?: string; revision?: string };
export type RecoveryCheck = 'same-owner' | 'current-authorization' | 'same-resource' | 'current-revision' | 'halt-clear' | 'fresh-approval' | 'actual-outcome' | 'read-succeeded' | 'persistence-confirmed';
export type RecoveryDescriptor = {
  strategy: 'review' | 'inspect' | 'retry-read' | 'replay-receipt' | 'reauthenticate' | 'repair-permissions' | 'wait' | 'never';
  target: string; requiresFreshApproval: boolean;
  version?: 2; ownerId?: string | null; operationId?: string | null;
  kind?: 'chat' | 'connector' | 'media' | 'research' | 'workspace' | 'build' | 'device' | 'authentication' | 'review';
  bindings?: RecoveryBindings; checks?: RecoveryCheck[]; notBefore?: string;
};
export type RecoveryAttempt = { id: string; at: string; state: 'reviewing' | 'failed' | 'verified'; operationId: string | null; reason?: string };
export type Incident = { id: string; code: string; target: string; message: string; state: 'open' | 'recovering' | 'resolved' | 'acknowledged'; at: string; recovery: RecoveryDescriptor; envelope?: FailureEnvelope; attempts?: RecoveryAttempt[]; resolvedAt?: string };
const text = (value: unknown, max=160): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/.test(value) ? value : undefined;
const states = ['open','recovering','resolved','acknowledged'];
const bindingKeys = ['chatId','workspaceId','pageId','grantGeneration','connectionId','model','projectId','reportId','revision'] as const;
function readBindings(value: unknown): RecoveryBindings {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(bindingKeys.flatMap(key => { const next=text(row[key]);return next ? [[key,next]] : []; }));
}
export const normalizeRecoveryBindings = readBindings;
export const incidentStorageKey = (owner: string | null) => `amcos.incidents.v1:${encodeURIComponent(owner ?? 'guest')}`;
export function retainIncidents(rows: Incident[]): Incident[] {
  const unique = [...new Map(rows.map(row => [row.id, row])).values()];
  return [...unique.filter(row => row.state === 'open' || row.state === 'recovering'), ...unique.filter(row => row.state === 'resolved' || row.state === 'acknowledged').slice(-100)];
}
/** A display dismissal is an acknowledgement. Typed incidents require explicit
 * evidence through verifyIncidentRecovery before they may become resolved. */
export function resolveIncident(rows: Incident[], id: string, state: Incident['state']): Incident[] {
  return retainIncidents(rows.map(row => row.id !== id || (state === 'resolved' && row.recovery.version === 2) ? row : { ...row, state }));
}
function kindFor(envelope: FailureEnvelope): NonNullable<RecoveryDescriptor['kind']> {
  return ({ chat:'chat',notion:'connector',mcp:'connector',connectors:'connector',image:'media',video:'media',voice:'media',research:'research',storage:'workspace',build:'build',pc:'device',auth:'authentication',fleet:'review',unknown:'review' } as const)[envelope.subsystem];
}
export function recoveryForFailure(envelope: FailureEnvelope, target: string, ownerId: string | null, bindings: RecoveryBindings = {}): RecoveryDescriptor {
  const consequential = envelope.operationKind === 'write' || envelope.operationKind === 'generation' || envelope.operationKind === 'unknown';
  const receiptReplay = envelope.retryPolicy === 'replay-receipt' && envelope.operationKind === 'generation' && envelope.subsystem === 'chat' && Boolean(envelope.operationId);
  let strategy: RecoveryDescriptor['strategy'] = envelope.retryPolicy;
  // A persisted descriptor never restores permission to repeat an uncertain write.
  if (consequential && !receiptReplay && (strategy === 'retry-read' || strategy === 'replay-receipt')) strategy = envelope.operationId ? 'inspect' : 'review';
  if (!receiptReplay && (envelope.outcome === 'completed' || envelope.outcome === 'partial' || (consequential && envelope.outcome === 'unknown' && !['reauthenticate','repair-permissions','never','wait'].includes(strategy)))) strategy = 'inspect';
  const checks: RecoveryCheck[] = ['same-owner','current-authorization','same-resource'];
  if (bindings.revision || bindings.grantGeneration) checks.push('current-revision');
  if (receiptReplay) checks.push('actual-outcome');
  else if (consequential) checks.push('halt-clear','fresh-approval','actual-outcome');
  else checks.push(envelope.subsystem === 'storage' ? 'persistence-confirmed' : 'read-succeeded');
  return { version: 2, ownerId, operationId: envelope.operationId, kind: kindFor(envelope), strategy, target: target.slice(0,200), requiresFreshApproval: consequential && !receiptReplay, bindings: readBindings(bindings), checks, ...(envelope.retryAfterAt ? { notBefore: envelope.retryAfterAt } : {}) };
}
export function createIncident(input: { id: string; ownerId: string | null; envelope: FailureEnvelope; target: string; bindings?: RecoveryBindings; temporary?: boolean; at?: string }): Incident | null {
  if (input.temporary) return null;
  const envelope = createFailureEnvelope(input.envelope);
  return { id: input.id, code: envelope.code, target: input.target.slice(0,200), message: envelope.message, state:'open',at: input.at ?? new Date().toISOString(), envelope, recovery: recoveryForFailure(envelope,input.target,input.ownerId,input.bindings),attempts:[] };
}
/** Only the exact operation can reuse an incident. Two failures in the same chat
 * are independent when no durable operation identity was supplied. */
export function incidentForOperation(rows: Incident[], ownerId: string | null, envelope: FailureEnvelope): Incident | null {
  return envelope.operationId ? rows.find(row => row.recovery.ownerId === ownerId && row.recovery.operationId === envelope.operationId && row.envelope?.subsystem === envelope.subsystem && row.state !== 'resolved' && row.state !== 'acknowledged') ?? null : null;
}
export function recordIncident(rows: Incident[], incident: Incident): Incident[] {
  const prior = rows.find(row => row.id === incident.id);
  const attempts = prior?.attempts?.map((attempt,index,all) => prior.state === 'recovering' && index === all.length-1 ? { ...attempt,state:'failed' as const } : attempt) ?? incident.attempts;
  return retainIncidents([...rows.filter(row => row.id !== incident.id), { ...incident, ...(attempts ? { attempts } : {}) }]);
}
export function readIncidents(storage: Pick<Storage, 'getItem'> | null, owner: string | null): Incident[] {
  try {
    const rows: unknown = JSON.parse(storage?.getItem(incidentStorageKey(owner)) ?? '[]');
    if (!Array.isArray(rows)) return [];
    return retainIncidents(rows.flatMap(value => {
      if (!value || typeof value !== 'object' || !text(value.id) || typeof value.target !== 'string' || typeof value.code !== 'string' || typeof value.message !== 'string' || !states.includes(value.state)) return [];
      if (value.recovery?.version === 2 && value.recovery.ownerId !== owner) return [];
      const envelope = readFailureEnvelope(value.envelope) ?? failureEnvelopeFromAction({ action:value.code,target:value.target,message:value.message });
      const incident = createIncident({id:value.id,ownerId:owner,envelope,target:value.target,bindings:readBindings(value.recovery?.bindings),at:typeof value.at==='string'?value.at:''})!;
      const attempts: RecoveryAttempt[] = Array.isArray(value.attempts) ? value.attempts.slice(-100).flatMap((row: unknown) => {
        if (!row || typeof row!=='object') return [];
        const a=row as Record<string,unknown>;
        return text(a.id) && typeof a.at==='string' && ['reviewing','failed','verified'].includes(String(a.state)) ? [{ id:a.id as string,at:a.at.slice(0,50),state:a.state as RecoveryAttempt['state'],operationId:text(a.operationId) ?? null }] : [];
      }) : [];
      return [{ ...incident, state:value.state as Incident['state'], attempts, ...(typeof value.resolvedAt==='string'?{resolvedAt:value.resolvedAt.slice(0,50)}:{}) }];
    }));
  } catch { return []; }
}
export type RecoveryContext = { ownerId:string|null; halted:boolean; now?:number; currentBindings?:RecoveryBindings };
export type RecoveryPlan = { allowed:boolean; view:'chat'|'connected'|'research'|'settings'|'build'|'activity'|'speak'|'files'; chatId?:string; strategy:RecoveryDescriptor['strategy']; reason:string; checks:RecoveryCheck[]; operationId:string|null; bindings:RecoveryBindings };
export function planIncidentRecovery(incident: Incident, context: RecoveryContext): RecoveryPlan {
  const descriptor=incident.recovery;
  const bindings=readBindings(descriptor.bindings);
  const view: RecoveryPlan['view'] = descriptor.kind==='chat' ? bindings.chatId?'chat':'activity' : descriptor.kind==='connector'?'connected':descriptor.kind==='research'?'research':descriptor.kind==='workspace'||descriptor.kind==='authentication'?'settings':descriptor.kind==='build'?'build':descriptor.kind==='media'?incident.envelope?.subsystem==='voice'?'speak':'files':'activity';
  const base:RecoveryPlan={allowed:true,view,...(bindings.chatId?{chatId:bindings.chatId}:{}),strategy:descriptor.strategy,reason:'Review the saved operation and current authorization. No action has been repeated.',checks:descriptor.checks??['same-owner','current-authorization','same-resource'],operationId:descriptor.operationId??null,bindings};
  if(descriptor.version!==2 || descriptor.ownerId!==context.ownerId)return{...base,allowed:false,reason:'This recovery record does not belong to the current verified account.'};
  if(descriptor.notBefore && Date.parse(descriptor.notBefore)>(context.now??Date.now()))return{...base,allowed:false,reason:`Wait until ${descriptor.notBefore} before another attempt.`};
  if(descriptor.strategy==='never')return{...base,allowed:false,reason:'This operation cannot be repeated through recovery. Review the blocking policy.'};
  if(context.halted && descriptor.requiresFreshApproval)return{...base,allowed:false,reason:'Emergency stop is on. Inspect the receipt; a new action requires a fresh authorized resume.'};
  if(context.currentBindings)for(const key of bindingKeys){const expected=bindings[key],current=context.currentBindings[key];if(expected&&current!==expected)return{...base,allowed:false,strategy:'review',reason:`The saved ${key} no longer matches. Review the original destination and authorization; another destination will not be selected.`};}
  if(descriptor.strategy==='inspect')return{...base,reason:'Inspect the exact operation receipt and destination first. The previous outcome does not authorize another write or paid generation.'};
  if(descriptor.strategy==='reauthenticate')return{...base,reason:'Sign in to the same account, then review this operation again.'};
  if(descriptor.strategy==='repair-permissions')return{...base,reason:'Repair access for the saved account and destination, then request fresh authorization.'};
  return base;
}
export function beginIncidentRecovery(rows:Incident[],id:string,context:RecoveryContext):{rows:Incident[];plan:RecoveryPlan|null}{
 const incident=rows.find(row=>row.id===id);if(!incident)return{rows,plan:null};
 const plan=planIncidentRecovery(incident,context);if(!plan.allowed)return{rows,plan};
 const attempt:RecoveryAttempt={id:crypto.randomUUID(),at:new Date(context.now??Date.now()).toISOString(),state:'reviewing',operationId:plan.operationId};
 return{plan,rows:retainIncidents(rows.map(row=>row.id===id?{...row,state:'recovering',attempts:[...(row.attempts??[]),attempt].slice(-100)}:row))};
}
export type RecoveryProof={ownerId:string|null;operationId:string|null;recoveryOf?:string|null;bindings?:RecoveryBindings;checks:RecoveryCheck[];verified:boolean;at?:string};
export function verifyIncidentRecovery(rows:Incident[],id:string,proof:RecoveryProof):Incident[]{
 return retainIncidents(rows.map(row=>{
  if(row.id!==id||row.recovery.version!==2||row.recovery.ownerId!==proof.ownerId||!proof.verified)return row;
  const operation=row.recovery.operationId;
  if(!operation && (proof.operationId!==null || proof.recoveryOf!==row.id))return row;
  if(operation && proof.operationId!==operation && proof.recoveryOf!==operation)return row;
  const expected=readBindings(row.recovery.bindings),actual=readBindings(proof.bindings);
  if(bindingKeys.some(key=>expected[key]&&expected[key]!==actual[key]))return row;
  if((row.recovery.checks??[]).some(check=>!proof.checks.includes(check)))return row;
  return{...row,state:'resolved',resolvedAt:proof.at??new Date().toISOString(),attempts:row.attempts?.map((attempt,index,all)=>index===all.length-1?{...attempt,state:'verified'}:attempt)};
 }));
}
