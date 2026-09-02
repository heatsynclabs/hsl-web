# The legacy import

Copies the Rails members database into this schema. It runs once per
environment, and it is what decides whether about a thousand people can still
sign in and whether sixty-three people can still open the door.

Read `docs/runbooks/import-the-members-database.md` before running it. This file
says what the script is. The runbook says what to do.

## Running it

```
LEGACY_DATABASE_URL=postgres://reader@old-host:5432/members \
DATABASE_URL=postgres://hsl@localhost:5432/hsl \
node --experimental-strip-types tools/import/main.ts --dry-run
```

Drop `--dry-run` to commit. There is no package.json here: the script resolves
`pg` from the API service, which is the only other thing in the repository that
opens a connection. `tools/import/pg.ts` does that and says why.

| Option | Does |
|---|---|
| `--dry-run` | everything, including the report, then rolls back |
| `--accept-orphans` | carries on past rows whose member no longer exists, skipping them and listing every one. Orphan cards are never skipped |
| `--help` | prints the options and exits |

| Variable | Holds |
|---|---|
| `LEGACY_DATABASE_URL` | the Rails database. Opened read only |
| `DATABASE_URL` | the members database this writes into. Must be migrated and empty |

## Testing it

Two real Postgres databases, both rebuilt from nothing before the suite runs.
Without both URLs the database suite skips itself and says what to set.

```
DATABASE_URL=postgres://hsl:hsl@localhost:5432/hsl_import_target \
LEGACY_DATABASE_URL=postgres://hsl:hsl@localhost:5432/hsl_import_legacy \
node_modules/.bin/vitest run --root tools/import
```

Both databases come from the Compose `db` service, per
`docs/decisions/0007-postgres-for-tests-comes-from-compose.md`. Create them
once:

```
docker compose up -d db
docker compose exec db createdb -U hsl hsl_import_target
docker compose exec db createdb -U hsl hsl_import_legacy
```

The fixtures are invented. `example.invalid` is reserved by RFC 2606 and can
never be registered, and no card number, name or hash in `test-support/` came
from the lab.

## What is in here

| File | Holds |
|---|---|
| `main.ts` | the order of operations, the two connections and the exit code |
| `legacy.ts` | the six read queries, the row shapes and the snapshot completeness check |
| `preflight.ts` | every check that can refuse or report, over the snapshot alone |
| `transform.ts` | card number padding, decimal to cents, card access, member ids |
| `load.ts` | the writes, in the order the foreign keys require |
| `reconcile.ts` | row counts from both databases side by side |
| `pg.ts` | the database driver, and why it is resolved the way it is |

## What it carries

Six tables, listed with their reasons in
`docs/decisions/0010-what-the-import-carries.md`: `users`, `cards`,
`certifications`, `user_certifications`, `payments` and `contracts`. Legacy
contracts become `waivers`. Everything else stays in the old database, which the
runbook keeps restorable and read only for a year.

Four things it will not do:

- Write to the legacy database. The connection is opened read only and every
  read happens inside one repeatable read snapshot.
- Renumber a card slot. `cards.id` is an EEPROM address. The slots are compared
  before and after the write and a difference stops the whole import.
- Commit half of itself. One transaction, rolled back on any failure.
- Claim success when the two databases disagree. The reconciliation runs before
  the commit and a disagreement rolls everything back.

## What it depends on

`pg`, resolved from `services/api`. Nothing else. The target schema comes from
`packages/schema/migrations` and this script defines no DDL of its own.
