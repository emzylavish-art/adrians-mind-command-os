import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHonestFailure, normalizeClientFailureMessage } from './failure-states.ts';
import { createFailureEnvelope, failureEnvelopeFromAction, notionFailureEnvelope, readFailureEnvelope, withFailureEnvelope } from './failure-envelope.ts';
import { beginIncidentRecovery, createIncident, incidentForOperation, incidentStorageKey, planIncidentRecovery, readIncidents, recordIncident, resolveIncident, verifyIncidentRecovery } from './incidents.ts';
import { consumeMindTurn } from './live-turn.ts';
import { relayModelStream } from './relay.ts';
const image = (operationId='operation-a') => failureEnvelopeFromAction({action:'image_generation_failed',target:'imagine:generate',message:'The output could not be saved.',operationId,provider:'xai',stage:'response',outcome:'unknown',operationKind:'generation'});
const incident = (operationId='operation-a') => createIncident({id:operationId,ownerId:'owner-a',envelope:image(operationId),target:'chat-a',bindings:{chatId:'chat-a',workspaceId:'workspace-a',grantGeneration:'grant-a'}})!;

test('AA069 structured subsystem/code wins even when copy contains misleading save/network words',()=>{
 const first=image();assert.equal(classifyHonestFailure(first),'image_generation_failed');
 assert.equal(classifyHonestFailure({...first,message:'Unexpectedly different wording. Unauthorized. Notion could not be saved.'}),'image_generation_failed');
 assert.equal(classifyHonestFailure(failureEnvelopeFromAction({action:'notion_search_failed',target:'notion:search',message:'could not be saved'})),'notion_failed');
 assert.equal(normalizeClientFailureMessage(first),first.message);
 assert.equal(classifyHonestFailure('The server copy could not be saved. The browser copy was kept.'),'database_write_failed');
});
test('AA069 wire adapter preserves successful payloads and unknown remote outcome',()=>{
 const success={ok:true,error:'',content:'fixture'};assert.equal(withFailureEnvelope(success,{subsystem:'notion'}),success);
 const result=withFailureEnvelope({ok:false,error:'Different human wording',operationId:'job-a',provider:'fixture'},{subsystem:'video',status:503,operationKind:'generation'}) as {failureEnvelope:unknown};
 const parsed=readFailureEnvelope(result.failureEnvelope)!;assert.equal(parsed.subsystem,'video');assert.equal(parsed.outcome,'unknown');assert.equal(parsed.operationId,'job-a');
 const blocked=withFailureEnvelope({ok:false,error:'Fixture refusal',dispatched:false},{subsystem:'voice',status:403}) as {failureEnvelope:unknown};
 assert.equal(readFailureEnvelope(blocked.failureEnvelope)?.outcome,'not_dispatched');
});
test('AA069 Notion structured permission and uncertain append are independent of error wording',()=>{
 const failure={operation:'append',httpStatus:403,code:'restricted_resource',kind:'permission',recovery:'review_access'};
 const permission=notionFailureEnvelope({action:'append',error:'Localized copy',wrote:false,verified:false,failure},'notion-op');
 assert.equal(permission.retryPolicy,'repair-permissions');assert.equal(permission.operationKind,'write');assert.equal(permission.outcome,'failed');
 const unknown=notionFailureEnvelope({action:'append',error:'Localized copy',wrote:false,verified:false,failure:{...failure,httpStatus:0,kind:'unavailable'}});
 assert.equal(unknown.outcome,'unknown');assert.equal(unknown.retryPolicy,'review');
});
test('AA074 uncertain generation persists a bound inspection plan without prompt, credentials, approval or callback',()=>{
 const row=incident();assert.equal(row.recovery.strategy,'inspect');assert.equal(row.recovery.requiresFreshApproval,true);
 const withSecrets={...row,recovery:{...row.recovery,prompt:'private text',token:'secret',confirmed:true,callback:'not callable'}};
 const storage={getItem:(key:string)=>key===incidentStorageKey('owner-a')?JSON.stringify([withSecrets]):null};
 const restored=readIncidents(storage,'owner-a');assert.equal(restored[0].recovery.bindings?.workspaceId,'workspace-a');
 const serialized=JSON.stringify(restored);for(const value of ['private text','secret','confirmed','callback'])assert.ok(!serialized.includes(value));
 assert.deepEqual(readIncidents(storage,'owner-b'),[]);
 assert.equal(createIncident({id:'temp',ownerId:'owner-a',envelope:image(),target:'chat-a',temporary:true}),null);
});
test('AA074 recovery refuses account, destination, grant, revision and halt drift',()=>{
 const row=incident();
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-b',halted:false}).allowed,false);
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-a',halted:true}).allowed,false);
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-a',halted:false,currentBindings:{chatId:'chat-a',workspaceId:'workspace-b',grantGeneration:'grant-a'}}).allowed,false);
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-a',halted:false,currentBindings:{chatId:'chat-a',workspaceId:'workspace-a',grantGeneration:'grant-b'}}).allowed,false);
 const plan=planIncidentRecovery(row,{ownerId:'owner-a',halted:false,currentBindings:row.recovery.bindings});assert.equal(plan.allowed,true);assert.equal(plan.view,'files');assert.equal(plan.chatId,'chat-a');assert.equal(plan.strategy,'inspect');
});
test('AA074 same target does not merge unrelated operations; failed retry retains attempt identity',()=>{
 const first=incident(),second=incident('operation-b');
 const rows=recordIncident([first],second);assert.equal(rows.length,2);assert.equal(incidentForOperation(rows,'owner-a',image('operation-b'))?.id,'operation-b');
 assert.equal(incidentForOperation(rows,'owner-b',image()),null);assert.equal(incidentForOperation(rows,'owner-a',{...image(),operationId:null}),null);
 const began=beginIncidentRecovery(rows,first.id,{ownerId:'owner-a',halted:false,now:1000});assert.equal(began.rows[0].state,'recovering');
 const repeated=recordIncident(began.rows,first);const updated=repeated.find(row=>row.id===first.id)!;assert.equal(updated.state,'open');assert.equal(updated.attempts?.[0].state,'failed');assert.equal(updated.attempts?.[0].id,began.rows[0].attempts?.[0].id);
});
test('AA074 only exact outcome evidence resolves a typed incident; unrelated success and dismissal are different',()=>{
 const row=incident(),rows=[row];assert.equal(resolveIncident(rows,row.id,'resolved')[0].state,'open');
 const proof={ownerId:'owner-a',operationId:'operation-a',bindings:row.recovery.bindings,checks:row.recovery.checks!,verified:true};
 assert.equal(verifyIncidentRecovery(rows,row.id,{...proof,operationId:'other-operation'})[0].state,'open');
 assert.equal(verifyIncidentRecovery(rows,row.id,{...proof,checks:['same-owner']})[0].state,'open');
 assert.equal(verifyIncidentRecovery(rows,row.id,{...proof,bindings:{chatId:'other-chat'}})[0].state,'open');
 assert.equal(verifyIncidentRecovery(rows,row.id,proof)[0].state,'resolved');
 assert.equal(resolveIncident(rows,row.id,'acknowledged')[0].state,'acknowledged');
});
test('AA074 rate-limit wait and expired session recovery survive reload without an old approval',()=>{
 const envelope=createFailureEnvelope({...image(),code:'rate_limited',retryPolicy:'wait',retryAfterAt:'2030-01-01T00:00:00.000Z'});
 const row=createIncident({id:'wait-a',ownerId:'owner-a',envelope,target:'chat-a'})!;
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-a',halted:false,now:0}).allowed,false);
 const auth=createIncident({id:'auth-a',ownerId:'owner-a',envelope:{...image(),code:'auth_required',retryPolicy:'reauthenticate'},target:'chat-a'})!;
 assert.equal(planIncidentRecovery(auth,{ownerId:'owner-a',halted:false}).strategy,'reauthenticate');
 assert.ok(!JSON.stringify(auth).includes('approvalToken'));
});
test('AA069 actual HTTP and SSE consumers preserve structured error metadata',async()=>{
 const envelope=image();const json=await consumeMindTurn({url:'https://fixture/turn',body:{},headers:{},signal:new AbortController().signal,onDelta:()=>{},fetchImpl:async()=>Response.json({ok:false,error:envelope.message,failureEnvelope:envelope},{status:503})});
 assert.equal(json.ok,false);if(!json.ok)assert.deepEqual(json.failureEnvelope,envelope);
 const stream=await consumeMindTurn({url:'https://fixture/turn',body:{},headers:{},signal:new AbortController().signal,onDelta:()=>{},fetchImpl:async()=>new Response(`event: error\ndata: ${JSON.stringify({error:'Changed wording',failureEnvelope:envelope})}\n\n`,{headers:{'content-type':'text/event-stream'}})});
 assert.equal(stream.ok,false);if(!stream.ok)assert.deepEqual(stream.failureEnvelope,envelope);
 const relay=relayModelStream({apiKey:'fixture-not-a-real-key',model:'fixture',messages:[],usedIds:[],requestSignal:new AbortController().signal,fetchImpl:async()=>new Response('',{status:503}),meta:{resourceOperationId:'resource-a',provider:'fixture'}});
 const result=await consumeMindTurn({url:'https://fixture/turn',body:{},headers:{},signal:new AbortController().signal,onDelta:()=>{},fetchImpl:async()=>relay});
 assert.equal(result.ok,false);if(!result.ok){assert.equal(result.failureEnvelope?.provider,'fixture');assert.equal(result.failureEnvelope?.operationId,'resource-a');assert.equal(result.failureEnvelope?.outcome,'unknown');}
});
test('AA069 resource budget, emergency stop, authorization and permission repairs keep different policies',()=>{
 for(const [code,status,expected] of [['resource_policy',403,'review'],['free_only',403,'review'],['emergency_stop',200,'never'],['unauthenticated',403,'reauthenticate'],['permission_denied',403,'repair-permissions'],['outcome_unknown',409,'review']] as const){
  const result=withFailureEnvelope({ok:false,code,error:'identical display text'},{subsystem:'voice',status}) as {failureEnvelope:unknown};
  const envelope=readFailureEnvelope(result.failureEnvelope)!;assert.equal(envelope.retryPolicy,expected,code);assert.equal(envelope.outcome,'unknown',code);
 }
});
test('AA074 original Chat receipt replay is a read recovery and cannot grant a new write approval',()=>{
 const envelope=failureEnvelopeFromAction({action:'chat_failed',target:'chat-a',message:'Delivery interrupted',operationId:'send-a',subsystem:'chat',operationKind:'generation',retryPolicy:'replay-receipt',outcome:'unknown'});
 const row=createIncident({id:'replay-a',ownerId:'owner-a',envelope,target:'chat-a',bindings:{chatId:'chat-a'}})!;
 assert.equal(row.recovery.strategy,'replay-receipt');assert.equal(row.recovery.requiresFreshApproval,false);
 assert.equal(planIncidentRecovery(row,{ownerId:'owner-a',halted:true}).allowed,true,'completed response inspection remains possible while new execution is halted');
 const write=createIncident({id:'write-a',ownerId:'owner-a',envelope:{...envelope,subsystem:'notion',operationKind:'write'},target:'notion'})!;
 assert.equal(write.recovery.strategy,'inspect');assert.equal(write.recovery.requiresFreshApproval,true);
 const unidentified=createIncident({id:'missing-op',ownerId:'owner-a',envelope:{...envelope,operationId:null},target:'chat-a'})!;
 assert.equal(verifyIncidentRecovery([unidentified],unidentified.id,{ownerId:'owner-a',operationId:'new-send',checks:unidentified.recovery.checks!,verified:true})[0].state,'open');
});
