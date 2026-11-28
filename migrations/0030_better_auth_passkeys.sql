-- Better Auth's WebAuthn adapter uses these case-sensitive column names.
create table if not exists "passkey" (
  "id" text primary key,
  "name" text,
  "publicKey" text not null,
  "userId" text not null references "user"("id") on delete cascade,
  "credentialID" text not null unique,
  "counter" bigint not null check ("counter" between 0 and 4294967295),
  "deviceType" text not null,
  "backedUp" boolean not null,
  "transports" text,
  "createdAt" timestamptz,
  "aaguid" text
);

create index if not exists "passkey_userId_idx" on "passkey" ("userId");
alter table "passkey" enable row level security;
