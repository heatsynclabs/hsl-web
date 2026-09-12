-- Invented development data, and obviously invented. Never run this anywhere
-- that holds real people.
--
-- Every password below is `correct-horse-battery`, hashed with Argon2id.

insert into certifications (slug, name) values
  ('laser', 'Laser Cutter'),
  ('cncmill', 'Mill (CNC)'),
  ('bigmill', 'Mill (Big)'),
  ('minimill', 'Mill (Mini)'),
  ('minilathe', 'Lathe (mini)'),
  ('biglathe', 'Lathe (Big)'),
  ('migwelder', 'Welder (MIG)'),
  ('tigwelder', 'Welder (TIG)'),
  ('tablesaw', 'Table Saw'),
  ('plasmacutter', 'Plasma Cutter')
on conflict (slug) do nothing;

insert into members (email, name, password, roles, oriented_on, door_access, member_level,
                     email_visible)
values
  ('ada@example.invalid', 'Ada Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{admin}', '2019-03-04', true, 50, true),
  ('brunel@example.invalid', 'Brunel Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{instructor}', '2021-11-12', true, 25, false),
  ('curie@example.invalid', 'Curie Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{}', null, false, 25, false)
on conflict do nothing;

insert into credentials (token, member_id, label)
select '0004B1C7', id, 'blue fob' from members where email = 'ada@example.invalid'
on conflict (token) do nothing;

insert into credentials (token, member_id, label)
select '0004B1C8', id, 'white card' from members where email = 'brunel@example.invalid'
on conflict (token) do nothing;
