# @hsl/schema

The contract every other package compiles against.

- `src/tables.ts` Drizzle definitions for the eleven tables, and the generated
  migrations under `migrations/`.
- `src/contracts.ts` Zod request and response schemas, one pair per route in
  `docs/architecture.md`. The API validates with them and `@hsl/api-client`
  types from them.
- `src/door.ts` The `DoorController` interface, the card slot and card number
  rules, and the payloads the API and the door service exchange.
- `src/members.ts` `memberLevelLabel` and `paymentStatus`, the two domain rules
  that turn stored values into what a person reads.
- `src/index.ts` The public surface. Nothing outside reaches past it.

## Running it

There is nothing to run. It is imported.

Changing `src/tables.ts` means emitting a migration and committing the SQL:

```
pnpm --filter @hsl/schema db:generate
pnpm --filter @hsl/schema db:migrate     # needs DATABASE_URL
```

`drizzle-kit generate` works offline. `migrate` needs a Postgres, which comes
from `docker compose up -d db`. Table and column comments are not expressible in
drizzle-orm 0.45.2, so they live in `migrations/0001_table_comments.sql` and are
edited by hand alongside the schema.

## Testing it

```
pnpm --filter @hsl/schema test
pnpm --filter @hsl/schema typecheck
```

The suites are pure and need no database. One of them reads the generated SQL to
prove nothing constrains a card slot out of the range production already holds.

## What it depends on

`drizzle-orm` and `zod` at runtime, `drizzle-kit` and `vitest` to develop with.
All four are pinned in the workspace catalog. It imports nothing from this
repository.
