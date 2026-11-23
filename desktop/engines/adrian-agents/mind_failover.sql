create table if not exists mind_failover_ownership (
  id integer primary key default 1,
  owner text not null,
  epoch integer not null,
  lease_expires bigint not null,
  flap_until bigint not null default 0,
  paused boolean not null default false,
  going_down boolean not null default false
);

create table if not exists mind_failover_events (
  id bigint generated always as identity primary key,
  at bigint not null,
  kind text not null,
  body jsonb not null
);
