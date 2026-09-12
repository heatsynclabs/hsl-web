-- Run this once a day. It is the whole of the housekeeping.
--
--   docker compose exec -T db psql -U hsl hsl < scripts/nightly.sql
--
-- audit_log is kept forever. It is small, and it is the thing that makes one
-- admin acting immediately defensible. door_events keeps two years: because
-- status is not an event, that table grows with building activity rather than
-- with poll frequency.

delete from sessions where expires_at < now();

delete from door_events where at < now() - interval '2 years';

update members set reset_token = null, reset_expires = null
where reset_expires < now();

-- Watch this go to zero. Then delete the bcrypt branch in api/src/auth.ts and
-- the bcryptjs dependency.
select count(*) as legacy_password_hashes_left
from members
where password is not null and password not like '$argon2%';
