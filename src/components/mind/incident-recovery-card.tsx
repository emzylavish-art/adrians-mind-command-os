import type { Incident, RecoveryPlan } from '../../lib/mind/incidents.ts';

/** Review only: this component receives no operation payload or execution callback. */
export function IncidentRecoveryCard({ incident, plan, onReview, onAcknowledge }: { incident: Incident; plan: RecoveryPlan; onReview: () => void; onAcknowledge: () => void }) {
  return <article className="border border-line rounded-panel p-3 space-y-2" data-incident-id={incident.id}>
    <p>{incident.message}</p>
    <p className="text-xs text-muted">{incident.code} · {incident.envelope?.subsystem ?? incident.target} · {incident.state}</p>
    {incident.envelope && <p className="text-xs text-muted">Stage: {incident.envelope.stage.replaceAll('_', ' ')} · Outcome: {incident.envelope.outcome.replaceAll('_', ' ')}{incident.envelope.provider ? ` · Provider: ${incident.envelope.provider}` : ''}</p>}
    {plan.operationId && <p className="text-xs text-muted break-all">Operation: {plan.operationId}</p>}
    {Object.keys(plan.bindings).length > 0 && <dl className="text-xs text-muted">{Object.entries(plan.bindings).map(([name,value]) => <div key={name} className="flex flex-wrap gap-x-2"><dt>{name}</dt><dd className="break-all">{value}</dd></div>)}</dl>}
    <p className="text-sm" role={plan.allowed ? undefined : 'status'}>{plan.reason}</p>
    <p className="text-xs text-muted">Checks before resolution: {plan.checks.map(check => check.replaceAll('-', ' ')).join(', ')}.</p>
    {incident.attempts?.length ? <p className="text-xs text-muted">Recovery attempts: {incident.attempts.length}. Latest: {incident.attempts.at(-1)?.state}.</p> : null}
    <div className="flex flex-wrap gap-3">
      <button type="button" className="min-h-11 text-accent disabled:opacity-50" disabled={!plan.allowed} onClick={onReview}>Open recovery review</button>
      <button type="button" className="min-h-11 text-muted" onClick={onAcknowledge}>Acknowledge</button>
    </div>
  </article>;
}
