# @hsl/api

The members API. Hono, better-auth and the routes in `docs/architecture.md`. It
is the only thing in the repository that writes to Postgres, and it never speaks
the door controller's wire protocol: it queues commands that the door service
collects and stores what the door service posts back.

Everything it validates with comes from `@hsl/schema`. This service defines no
tables and no request shapes of its own.

## Running it

```
docker compose up -d db api
```

Development runs it from the repository root with `pnpm dev`, which watches
`src/main.ts`. Configuration is read once at boot and a missing value stops the
process with a message naming it, so a misconfigured host fails at start rather
than on the first request.

| Variable | Holds |
|---|---|
| `DATABASE_URL` | the connection string. `DATABASE_PASSWORD` or `DATABASE_PASSWORD_FILE` is folded into it |
| `PUBLIC_ORIGIN` | the one origin everything is served from. It sets the trusted origin list and decides whether cookies are Secure |
| `AUTH_SECRET` | signs sessions. `AUTH_SECRET_FILE` reads it from a Compose secret |
| `DOOR_TOKEN` | the shared credential the door service presents. `DOOR_TOKEN_FILE` likewise |
| `PORT` | defaults to 3000 |
| `LEGACY_PEPPER` | empty unless a pepper is ever found in the Rails configuration. See `docs/decisions/0004-keep-bcrypt.md` |
| `DOOR_STATUS_STALE_SECONDS` | how long the last door report stays trustworthy. Defaults to 120 |
| `SPACE_API_TEMPLATE_PATH` | the SpaceAPI document the lab edits. Without it a minimal built-in template is served |

## Testing it

```
pnpm --filter @hsl/api test
pnpm --filter @hsl/api typecheck
```

Tests run the app in process through `hono/testing`, with no port and no mocked
database. Suites that need Postgres read `DATABASE_URL` and skip with a message
saying so when it is not set. Before the suite runs, `src/test-support/global-setup.ts`
drops the schema and replays `packages/schema/migrations` into it, so a
migration that only works against an already migrated database fails here.

```
DATABASE_URL=postgres://hsl:hsl@localhost:5432/hsl_test pnpm --filter @hsl/api test
```

Test files run one at a time, because they share one database.

The suite that matters most is `src/routes/authorization.test.ts`: one test per
authorization rule per role, including anonymous, and including the case that
must be refused.

## What is in here

| File | Holds |
|---|---|
| `main.ts` | reads the configuration, starts the server, nothing else |
| `app.ts` | builds the Hono app and mounts the middleware and route groups |
| `config.ts` | the environment, parsed and checked once |
| `db.ts` | the pool and the Drizzle instance |
| `auth.ts` | better-auth, with bcrypt so imported passwords keep working |
| `audit.ts` | the one function that writes an audit row |
| `context.ts` | what a route group is handed and what the session middleware sets |
| `views.ts` | database rows turned into the response shapes in `@hsl/schema` |
| `middleware/session.ts` | resolves the session and puts the member on the context |
| `middleware/require.ts` | the authorization rules, one helper each |
| `middleware/validate.ts` | request validation against the contracts |
| `routes/*` | one file per route group |

## What it depends on

`hono`, `@hono/node-server` and `@hono/zod-validator` for the HTTP surface,
`better-auth` with `bcryptjs` for sessions and passwords, `drizzle-orm` and `pg`
for the database, and `zod` through `@hsl/schema` for every request and response
shape. It imports from `packages/*` only.

## Two things worth knowing before changing it

**Rear unlock is refused here, not on the controller.** The lab decision of
2018-02-22 lives in `routes/door.ts`, above the adapter, so it holds whatever
hardware is underneath. The refusal is audited.

**`/space_api.json` is read by things outside this repository.** The lab website
and an ESP8266 status LED both parse it. `routes/space-api.ts` records what the
Rails version did, which two defects it carried, and what was decided about each.
