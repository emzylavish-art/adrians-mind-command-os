create table if not exists mind_managed_browser_control (
  user_id text not null references mind_snapshot(user_id) on delete cascade,
  session_id uuid not null,
  origin text not null,
  phase text not null check (phase in ('starting','managed','manual','closed','uncertain')),
  revision integer not null default 1,
  pending text,
  pending_at timestamptz,
  expires_at timestamptz not null,
  receipts jsonb not null default '[]'::jsonb,
  primary key (user_id,session_id)
);
create index if not exists mind_managed_browser_control_owner
  on mind_managed_browser_control(user_id,expires_at desc);
alter table mind_managed_browser_control enable row level security;

-- Keep earlier receipt history when replacing the browser worker protocol.
insert into mind_snapshot(user_id,payload)
select distinct user_id,'{}'::jsonb from mind_managed_browser on conflict do nothing;

insert into mind_managed_browser_control(user_id,session_id,origin,phase,expires_at,receipts)
select s.user_id,s.id,s.origin,case when s.mode='stopped' then 'closed' else 'uncertain' end,s.updated_at,
  coalesce((select jsonb_agg(jsonb_build_object('action',recent.action,'phase',
    case when recent.action='stop' and recent.outcome='confirmed' then 'closed' else 'uncertain' end,
    'at',recent.recorded_at,'outcome',recent.outcome) order by recent.recorded_at)
    from (select action,outcome,recorded_at from mind_managed_browser_receipt
      where session_id=s.id order by recorded_at desc limit 16) recent),'[]'::jsonb)
from mind_managed_browser s on conflict do nothing;
