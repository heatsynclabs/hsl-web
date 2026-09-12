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

insert into members (email, name, password, roles, oriented, door_access, member_level)
values
  ('ada@example.invalid', 'Ada Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{admin}', true, true, 50),
  ('brunel@example.invalid', 'Brunel Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{instructor}', true, true, 25),
  ('curie@example.invalid', 'Curie Example',
   '$argon2id$v=19$m=19456,t=2,p=1$ejHofG2Lp5MASVPBnGoR/w$FikxKx0YsAprzYuohHAi8B+KHGlLnwwI7QCducG//F8',
   '{}', false, false, 25)
on conflict do nothing;

insert into credentials (token, member_id, label)
select '0004B1C7', id, 'blue fob' from members where email = 'ada@example.invalid'
on conflict (token) do nothing;

insert into credentials (token, member_id, label)
select '0004B1C8', id, 'white card' from members where email = 'brunel@example.invalid'
on conflict (token) do nothing;
