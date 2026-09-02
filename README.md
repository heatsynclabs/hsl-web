# hsl-web

The HeatSync Labs members and door system.

It holds the membership, the RFID cards, the certifications and the dues record,
and it is the only thing that talks to the door controller. It replaces a Rails
3.2 application running on Ruby 1.9.3, both of which stopped receiving security
patches around 2015.

Nothing here is deployed yet. Nothing in production has been touched.

## What is in here

```
apps/members     profile, cards, certifications, dues, door controls, sign in
apps/signup      join: account, waiver, tier, what happens next
apps/admin       directory, member detail, access, audit

packages/ui          GANTRY tokens, the marks, the shared Vue components
packages/schema      the tables, the request and response schemas, the types
packages/api-client  a typed client over those schemas

services/api     Hono and better-auth. The only thing that writes to Postgres.
services/door    the door controller adapters and the reconcile loop.
                 Runs on the lab LAN. Holds the controller password.

docs/            architecture, the verified legacy facts, operations, decisions
infra/           the Caddy config and the lab host's compose file
tools/           backup, restore, the restore drill, the voice check
```

TypeScript throughout. One pnpm workspace, one Postgres, everything under Docker
Compose.

## Running it

```
cp .env.example .env
echo 'COMPOSE_FILE=compose.yaml:compose.dev.yaml' >> .env
make secrets
docker compose up -d db api
pnpm install
pnpm dev
```

`docs/operations.md` covers deployment, backups, and what to check when something
is wrong.

## Testing it

```
pnpm check      # lint, typecheck, test
```

Tests that need a database read `DATABASE_URL` and skip with a message when it is
not set. The door service tests run against a fake controller that speaks the
real wire protocol, so they need no hardware.

## The two things that must not break

**The door keeps working.** The controller holds its own card table in EEPROM.
When this system, the network or the internet is down, physical cards still open
the building. Only remote control and syncing pause. Every phase of the work is
built to keep that true.

**One URL cannot change.** The lab website and an ESP8266 status LED both read
`/space_api.json` for the open and closed indicator. The payload shape is a
contract with things outside this repository, and parity gets proven on a test
hostname before the hostname moves.

## Before contributing

Read `CONTRIBUTING.md`. It is short and it binds. The parts people miss most
often: no em dashes, no emoji, no model attribution in commits, and comments that
explain why rather than what.

`docs/legacy-system.md` records what the production database and the Rails and
firmware sources actually say, checked against a restored dump rather than taken
from the planning documents. Where any other document disagrees with it, it wins.

## Licence

Apache 2.0. `ATTRIBUTIONS.md` lists the dependencies and the borrowed patterns,
including the earlier HeatSync work this builds on.
