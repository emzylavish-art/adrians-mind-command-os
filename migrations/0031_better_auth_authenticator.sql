-- Better Auth's password-sign-in authenticator and encrypted recovery records.
alter table "user" add column if not exists "twoFactorEnabled" boolean default false;

create table if not exists "twoFactor" (
  "id" text primary key,
  "secret" text not null,
  "backupCodes" text not null,
  "userId" text not null unique references "user"("id") on delete cascade,
  "verified" boolean not null default true,
  "failedVerificationCount" integer not null default 0,
  "lockedUntil" timestamptz
);
alter table "twoFactor" enable row level security;
