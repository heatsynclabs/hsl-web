-- The legacy Rails schema, and invented rows in it, for rehearsing the import.
--
-- Column names and types are from db/schema.rb in
-- heatsynclabs/Open-Source-Access-Control-Web-Interface at version
-- 20141120200638. There are no foreign keys, because the production database
-- has none anywhere, and the import has to tolerate that.
--
-- Every person here is invented and every address ends in .invalid. Load it
-- into a scratch database and point LEGACY_DATABASE_URL at it.

create table users (
  id serial primary key,
  name varchar(255),
  email varchar(255) not null default '',
  encrypted_password varchar(255) not null default '',
  phone varchar(255),
  postal_code varchar(255),
  emergency_name varchar(255),
  emergency_phone varchar(255),
  emergency_email varchar(255),
  member_level integer,
  waiver timestamp,
  orientation timestamp,
  oriented_by_id integer,
  hidden boolean default false,
  email_visible boolean default false,
  phone_visible boolean default false,
  current_skills text,
  desired_skills text,
  payment_method varchar(255),
  payee varchar(255),
  admin boolean default false,
  instructor boolean default false,
  accountant boolean default false,
  created_at timestamp not null,
  updated_at timestamp not null
);

create table cards (
  id integer primary key,            -- the EEPROM slot. Not a sequence.
  card_number varchar(255),
  card_permissions integer,
  user_id integer,
  name varchar(255),
  created_at timestamp,
  updated_at timestamp
);

create table certifications (
  id serial primary key,
  slug varchar(255),
  name varchar(255),
  description text
);

create table user_certifications (
  id serial primary key,
  user_id integer,
  certification_id integer,
  created_by integer,
  created_at timestamp not null
);

create table payments (
  id serial primary key,
  user_id integer,
  amount numeric,
  "date" date,
  created_by integer,
  created_at timestamp not null
);

create table contracts (
  id serial primary key,
  user_id integer,
  signed_at timestamp,
  document_file_name varchar(255),
  cosigner varchar(255),
  created_by_id integer,
  created_at timestamp not null
);

-- The password on every row below is `correct-horse-battery`, hashed with
-- bcrypt at cost 10 with the $2a$ prefix, which is what Devise wrote.
insert into users
  (id, name, email, encrypted_password, phone, member_level, orientation, hidden,
   current_skills, admin, instructor, accountant, created_at, updated_at)
values
  (1, 'Ada Example', 'ada@example.invalid',
   '$2a$10$eNPiWo2SJ/agF7AvCWbTZ.E1JUH6V6OFwQXi3DY9NRMfPR7iFo0pO',
   '480-555-0100', 50, '2019-03-04 18:00:00', false, 'laser cutting',
   true, false, false, '2015-06-01 12:00:00', '2026-01-02 12:00:00'),
  (2, 'Brunel Example', 'brunel@example.invalid',
   '$2a$10$eNPiWo2SJ/agF7AvCWbTZ.E1JUH6V6OFwQXi3DY9NRMfPR7iFo0pO',
   null, 25, '2021-11-12 19:30:00', false, null,
   false, true, false, '2021-11-01 12:00:00', '2026-01-02 12:00:00'),
  -- One of the 31 accounts with no password. They could not sign in before
  -- either, and they use password reset.
  (3, 'Curie Example', 'curie@example.invalid', '', null, null, null, true, null,
   false, false, true, '2013-02-02 12:00:00', '2013-02-02 12:00:00');

-- Slot 14 is the lowest in production. Slot 200 is the one the firmware writes
-- and never reads, so that member's card has silently never worked.
insert into cards (id, card_number, card_permissions, user_id, name) values
  (14, '4b1c7', 1, 1, 'blue fob'),
  (37, '104b1c8', 1, 2, 'white card'),
  (200, 'a9f21', 1, 3, 'the one that never worked');

insert into certifications (id, slug, name) values
  (1, 'laser', 'Laser Cutter'),
  (2, 'tablesaw', 'Table Saw');

insert into user_certifications (user_id, certification_id, created_by, created_at) values
  (1, 1, 2, '2020-01-15 17:00:00'),
  (2, 2, 1, '2022-05-05 17:00:00'),
  -- A grantor that is not in users. The legacy database has no foreign keys.
  (2, 1, 9999, '2022-05-06 17:00:00');

insert into payments (user_id, amount, "date", created_by, created_at) values
  (1, 50.00, '2026-01-05', 3, '2026-01-05 12:00:00'),
  (1, 50.00, '2026-02-05', 3, '2026-02-05 12:00:00'),
  (2, 25.00, '2026-02-07', 3, '2026-02-07 12:00:00'),
  -- A payment belonging to nobody. Reported as a warning and left behind.
  (9999, 25.00, '2026-02-08', 3, '2026-02-08 12:00:00');

insert into contracts (user_id, signed_at, document_file_name, created_at) values
  (1, '2015-06-01 12:00:00', 'waiver-1.pdf', '2015-06-01 12:00:00'),
  (2, '2021-11-01 12:00:00', 'waiver-2.pdf', '2021-11-01 12:00:00');
