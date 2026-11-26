import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createIncident, planIncidentRecovery } from '../../lib/mind/incidents.ts';
import { failureEnvelopeFromAction } from '../../lib/mind/failure-envelope.ts';
const hooks=registerHooks({load(url,context,next){if(url.endsWith('/incident-recovery-card.tsx'))return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};return next(url,context);}});
const {IncidentRecoveryCard}=await import('./incident-recovery-card.tsx');hooks.deregister();
const incident=createIncident({id:'incident-a',ownerId:'owner-a',target:'notion',envelope:failureEnvelopeFromAction({action:'notion_failed',target:'notion',message:'Destination verification is unavailable.',operationId:'append-a',provider:'notion',stage:'verify',outcome:'unknown',operationKind:'write',retryPolicy:'review'}),bindings:{chatId:'chat-a',workspaceId:'workspace-a',pageId:'page-a',grantGeneration:'grant-a'}})!;
test('AA074 actual recovery card renders original destination, uncertainty and checks without executing',()=>{
 let ran=0;const plan=planIncidentRecovery(incident,{ownerId:'owner-a',halted:false});
 const html=renderToStaticMarkup(createElement(IncidentRecoveryCard,{incident,plan,onReview:()=>{ran++;},onAcknowledge:()=>{ran++;}}));
 for(const text of ['append-a','workspace-a','page-a','grant-a','Outcome: unknown','fresh approval','Open recovery review'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/>Retry<|>Repeat write<|>Run</);assert.equal(ran,0);
});
test('AA074 blocked owner/halt recovery visibly disables review and keeps acknowledgement distinct',()=>{
 const plan=planIncidentRecovery(incident,{ownerId:'owner-b',halted:false});
 const html=renderToStaticMarkup(createElement(IncidentRecoveryCard,{incident,plan,onReview:()=>{},onAcknowledge:()=>{}}));
 assert.match(html,/does not belong to the current verified account/);assert.match(html,/disabled=""/);assert.match(html,/Acknowledge/);
});
