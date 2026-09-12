# Import the members database

Run once, against a read-only restored copy of the production dump. Never
against the live system.

Allow an hour. Nothing here is reversible except by dropping the target
database, which is step 7.

## 1. Restore the dump into a scratch Postgres

The production database is Postgres 8.4.20 on 32 bit CentOS 6.8. Restore it into
a modern Postgres rather than connecting to the live one, which removes both the
risk and the client compatibility question.

```sh
docker run -d --name legacy -e POSTGRES_PASSWORD=legacy -p 5433:5432 postgres:17
pg_restore -h localhost -p 5433 -U postgres -d postgres --no-owner members-*.dump
```

Expect: exit code 0 and no errors. Anything else, stop and say so.

### Rehearsing it without the dump

`scripts/legacy-fixture.sql` is the legacy schema with three invented people in
it, including one with no password, one card at slot 200 and one payment
belonging to nobody. Load it into a scratch database and the rest of this
runbook works the same way.

```sh
createdb -h localhost -p 5433 -U postgres rehearsal
psql -h localhost -p 5433 -U postgres rehearsal -f scripts/legacy-fixture.sql
```

## 2. Point the import at both databases

```sh
export LEGACY_DATABASE_URL=postgres://postgres:legacy@localhost:5433/postgres
export DATABASE_URL=postgres://hsl:<password>@localhost:5432/hsl
```

## 3. Preflight

```sh
make import
```

Expect a count block, then warnings, then either failures or a line saying to
run it again with `--apply`.

```
{
  "members": 1061,
  "credentials": 64,
  "certifications": 10,
  "memberCertifications": 415,
  "payments": 8291,
  "waivers": 318,
  "withDoorAccess": 63,
  "withoutPassword": 31
}
```

Those numbers are what the production dump held on 2026-09-01. A number that
differs is not an error, and a number that differs by a lot is worth
understanding before continuing.

Failures stop the import and nothing is written. Each names a legacy row id:

- a password hash that is neither `$2a$10$` nor empty
- two users sharing an email under `lower(email)`
- a card whose user does not exist
- two cards whose ids normalise to the same value

Warnings are reported and do not stop it: duplicate certification pairs, skills
text longer than a profile edit accepts, and payments or contracts belonging to
a user that is not there.

## 4. Write

```sh
make import ARGS=--apply
```

One transaction. If it fails, nothing was written.

## 5. Check the card slots survived

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select c.legacy_slot, p.placement from credentials c
     join door_placements p on p.credential_id = c.id
    order by c.legacy_slot limit 5"
```

Expect `legacy_slot` and the `slot` inside the placement to be the same number
on every row. They are EEPROM addresses and renumbering one hands a member
somebody else's door permission.

One card is at slot 200. That is expected: the firmware writes that slot and
never reads it, so that member's card has silently never worked. The first
reconcile pass moves it and says so.

## 6. Verify by signing in

Not row counts. Sign in on staging as three real migrated members from different
eras of the space, using their known passwords. Ask them first.

Then check the hash was upgraded in place:

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select count(*) from members where password like '\$argon2%'"
```

Expect: one per member who signed in.

## 7. If it went wrong

```sh
docker compose exec -T db psql -U hsl postgres -c "drop database hsl"
docker compose exec -T db psql -U hsl postgres -c "create database hsl"
make migrate
```

Then fix what the failures named and start again at step 3.

## If there is no legacy database

A fresh install has no admin. Make the first one by hand, and record it, because
nothing else will:

```sql
update members set roles = array['admin'], oriented = true
where lower(email) = 'someone@heatsynclabs.org';

insert into audit_log (actor_id, action, target_id, detail)
select id, 'member.update', id::text, '{"fields":["roles"],"by":"first admin, by hand"}'
from members where lower(email) = 'someone@heatsynclabs.org';
```
