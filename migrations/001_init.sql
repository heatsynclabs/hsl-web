-- Thirteen tables. The whole schema.
--
-- Forward only. Write each migration so the release before it still runs: add
-- a column one release before anything uses it, drop it one release after.

create extension if not exists pgcrypto;

-- 1. Identity ---------------------------------------------------------------

create table members (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  name           text not null,
  password       text,                             -- null means no credential yet
  roles          text[] not null default '{}',     -- admin | instructor | accountant
  status         text not null default 'active',   -- active | lapsed | suspended
  -- The date rather than a flag. Around seven hundred legacy rows carry when
  -- orientation happened, and a boolean throws that away. Guards read it as
  -- "is this null".
  oriented_on    date,
  hidden         boolean not null default false,
  door_access    boolean not null default false,
  member_level   integer,                          -- carries both dollars and label, as legacy did
  phone          text,
  postal_code    text,
  emergency_name text,
  emergency_phone text,
  emergency_email text,
  current_skills text,
  desired_skills text,
  -- Real preferences, not a new idea: the legacy users table carried both and
  -- members set them. The directory shows an address or a number only where
  -- its member turned the field on.
  email_visible  boolean not null default false,
  phone_visible  boolean not null default false,
  joined_on      date not null default current_date,
  reset_token    text,
  reset_expires  timestamptz,
  legacy_id      integer,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index members_email_key  on members (lower(email));
create unique index members_legacy_key on members (legacy_id) where legacy_id is not null;
create unique index members_reset_key  on members (reset_token) where reset_token is not null;

create table sessions (
  token      text primary key,
  member_id  uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip         inet
);

create index sessions_member_idx  on sessions (member_id);
create index sessions_expires_idx on sessions (expires_at);

create table service_tokens (
  id          text primary key,                    -- 'door-front', 'kiosk-lobby'
  name        text not null,
  secret_hash text not null,
  scopes      text[] not null default '{}',
  last_seen   timestamptz,
  revoked     boolean not null default false
);

-- 2. Membership -------------------------------------------------------------

create table credentials (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,                -- the card id, normalised, any length
  member_id   uuid not null references members(id) on delete restrict,
  label       text,
  active      boolean not null default true,
  issued_on   date not null default current_date,
  legacy_slot integer                              -- correlation only, never read
);

create index credentials_member_idx on credentials (member_id);

create table certifications (
  slug        text primary key,                    -- 'laser', 'tablesaw'
  name        text not null,
  description text
);

create table member_certifications (
  member_id  uuid not null references members(id) on delete cascade,
  cert_slug  text not null references certifications(slug),
  granted_by uuid references members(id),
  granted_at timestamptz not null default now(),
  primary key (member_id, cert_slug)
);

create table payments (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  amount      numeric(10,2) not null,
  paid_on     date not null,
  method      text,
  note        text,
  recorded_by uuid references members(id),
  legacy_id   integer
);

create index payments_member_idx on payments (member_id, paid_on desc);

create table waivers (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references members(id) on delete restrict,
  signed_at  timestamptz not null,
  document   text,                                 -- pointer, not a copy
  cosigner   text,                                 -- for a member who signed under 18
  legacy_id  integer
);

create index waivers_member_idx on waivers (member_id);

-- 3. The record -------------------------------------------------------------

create table audit_log (
  id        bigserial primary key,
  actor_id  uuid references members(id),
  action    text not null,
  target_id text,
  detail    jsonb,
  at        timestamptz not null default now()
);

create index audit_log_at_idx    on audit_log (at desc);
create index audit_log_actor_idx on audit_log (actor_id, at desc);

create table door_events (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  controller_id text not null,
  kind          text not null,   -- entry | denied | presented | alarm | fault | command
  token         text,
  member_id     uuid references members(id) on delete set null,
  door          text,
  detail        jsonb
);

create index door_events_at_idx     on door_events (at desc);
create index door_events_member_idx on door_events (member_id, at desc);

-- Append only, in the database rather than by convention. The message names
-- TG_TABLE_NAME rather than a literal: one trigger function serves two tables
-- and blaming the wrong one tells whoever hit it something false.
create function refuse_change() returns trigger as $$
begin
  raise exception
    '% is append only. The row was left as it was. Record a new row describing the correction instead.',
    TG_TABLE_NAME;
end;
$$ language plpgsql;

create trigger audit_log_append_only   before update or delete on audit_log
  for each row execute function refuse_change();
create trigger door_events_append_only before update or delete on door_events
  for each row execute function refuse_change();

-- 4. The door ---------------------------------------------------------------

-- Current state is upserted, never appended. The legacy system wrote a status
-- snapshot into its event log on every poll and reached 2,868,091 rows, 2.8
-- million of them snapshots. This schema cannot do that.
--
-- capabilities is what the adapter declared on its last report, carried here so
-- the API can refuse a command the hardware cannot run before queueing it. It
-- is controller wide and repeated on each of that controller's rows, which
-- costs one array per door and saves a table.
create table door_state (
  controller_id text not null,
  door          text not null,
  state         text not null,              -- locked | unlocked | unknown
  capabilities  text[] not null default '{}',
  reported_at   timestamptz not null,
  primary key (controller_id, door)
);

create table door_commands (
  id            uuid primary key default gen_random_uuid(),
  controller_id text not null,
  action        text not null,              -- open | lock | unlock | alarm.arm | alarm.disarm
  door          text,
  requested_by  uuid references members(id),
  requested_at  timestamptz not null default now(),
  claimed_at    timestamptz,
  resolved_at   timestamptz,
  outcome       text                        -- done | failed | refused | expired
);

create index door_commands_open_idx on door_commands (controller_id)
  where resolved_at is null;

-- The only column in this database the API is forbidden to read. It is written
-- by the adapter, handed back to the adapter, and that is the whole of its life
-- here. No query filters on it, no index touches its keys, no response renders
-- it as anything but opaque JSON.
--
-- The cascade is load bearing. Revoke a credential, the placement goes with it,
-- and the next pass sees a card on the device that nothing claims and clears
-- it. That is the revoke-then-restart bug solved by a foreign key.
create table door_placements (
  controller_id text not null,
  credential_id uuid not null references credentials(id) on delete cascade,
  placement     jsonb not null,
  written_at    timestamptz not null default now(),
  primary key (controller_id, credential_id)
);
