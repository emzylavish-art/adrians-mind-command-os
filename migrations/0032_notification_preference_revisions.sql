alter table mind_notification_target
  add column if not exists preference_revision uuid not null default gen_random_uuid();

alter table mind_notification_delivery
  add column if not exists preference_revision uuid;

create or replace function mind_rotate_notification_preference_revision()
returns trigger language plpgsql as $$
begin
  if new.preferences is distinct from old.preferences then
    new.preference_revision := gen_random_uuid();
  end if;
  return new;
end;
$$;

drop trigger if exists mind_notification_target_preference_revision on mind_notification_target;
create trigger mind_notification_target_preference_revision
before update of preferences on mind_notification_target
for each row execute function mind_rotate_notification_preference_revision();
