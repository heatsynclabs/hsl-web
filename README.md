# hsl-web

The HeatSync Labs members and door system.

It holds the membership, the RFID cards, the certifications and the dues record,
and it is the only thing that talks to the door controller. It replaces a Rails
3.2 application running on Ruby 1.9.3, both of which stopped receiving security
patches around 2015.

Nothing here is deployed yet. Nothing in production has been touched.

![The members portal](docs/screenshots/members-profile.jpg)

## Run the whole thing on your machine

Everything runs in Docker: Postgres, the API, the three apps behind Caddy, and a
mail catcher. You need Docker and nothing else. Node and pnpm are only needed if
you want to change the code.

```
git clone https://github.com/heatsynclabs/hsl-web
cd hsl-web
cp .env.example .env
make secrets
make up
make seed
```

That is the whole thing. `make up` builds the images and starts the stack;
`make seed` fills it with invented members so there is something to look at.

Open **http://localhost:9080** and sign in with any of these. The password for
all of them is `heatsync`.

| Sign in as | Sees |
|---|---|
| `sam@example.test` | an ordinary member: own profile, own card, own certifications |
| `dana@example.test` | an admin: the directory, every member, the audit log |
| `jules@example.test` | an instructor: grants and revokes certifications |
| `ari@example.test` | an accountant: records dues payments |

Three apps, one session, all on one origin:

| URL | What |
|---|---|
| http://localhost:9080 | the members portal, and where you sign in |
| http://localhost:9080/signup | joining the lab |
| http://localhost:9080/admin | the admin portal, for `dana@example.test` |
| http://localhost:9080/space_api.json | the public status document |
| http://localhost:8026 | every email the system sent, including reset links |

`.env.example` uses port 9080 so nothing collides with another stack and Docker
does not need to bind a privileged port. Change `HSL_HTTP_PORT` if you like, and
change `HSL_PUBLIC_ORIGIN` to match, because the session cookie is checked
against it.

To start over, `make reset` throws the database away and rebuilds it from the
migrations. Then `make seed` again.

To stop, `make down`.

## Run it against the real members database

The same stack, with a copy of the old Rails database beside it and the import
run against it. You need a `pg_dump` custom format file. There is a runbook at
`docs/runbooks/import-the-members-database.md`; this is the short version.

```
cp members-backup.dump legacy/members.dump

make reset                       # an empty database for the import to write into
make legacy-restore              # restores the dump into a container
make import ARGS=--dry-run       # reads everything, reports, writes nothing
make import ARGS=--accept-orphans
```

The dry run prints what it found and refuses if anything needs a decision. On
the production dump it reports 31 members with no password, one card in a slot
the reader cannot see, and 67 rows belonging to members who no longer exist. It
tells you what each one means and leaves the choice to you.

The import then reconciles both databases side by side and refuses to claim
success if the counts disagree:

```
Reconciliation:
  what                                        legacy  imported   skipped
  members                                       1061      1061         0
  credentials                                   1030      1030         0
  cards                                           64        64         0
  members with card access (permission 1)         63        63         0
  certifications                                  10        10         0
  certification grants                           415       414         1
  payments                                      8291      8290         1
  signed releases                                318       253        65
```

Everybody keeps the password they already had. The bcrypt hashes are copied
verbatim and the new system keeps speaking bcrypt, so nobody resets anything.

`legacy/` is gitignored. Never commit a dump: it holds names, addresses,
emergency contacts and a record of who entered a building.

## What the apps look like

**Members.** A member's own record, their cards, their certifications and their
dues. The door controls are the second tab.

![The door screen](docs/screenshots/members-door.jpg)

The door screen is honest about what it knows. When the door service has not
reported recently the two tiles read Unknown rather than guessing, the controls
are disabled rather than queueing into silence, and the screen says physical
cards still open the door. Unlocking the rear door stays on the screen and stays
refused, with the 2018 lab decision written beside it, so nobody adds it back by
mistake.

**Signup.** Five steps, and nothing is sent to the lab until the last one.

![Choosing a tier](docs/screenshots/signup-dues.jpg)

The tiers are the ones the lab actually uses. The app never takes a card number:
it records what somebody chose and tells them how to send the money.

![What happens next](docs/screenshots/signup-done.jpg)

**Admin.** The directory, every member's record, and the audit log.

![The admin directory](docs/screenshots/admin-directory.jpg)

There is no approval queue. Any admin acts immediately and every privileged
change is written to a log that cannot be edited, deleted or truncated, enforced
by the database rather than by a screen. That decision is written down in
`docs/decisions/0008-single-admin-plus-audit-log.md`.

![The audit log](docs/screenshots/admin-audit.jpg)

## Working on the code

The stack above serves built apps. For hot reload, run the database and API in
Docker and the apps on the host:

```
echo 'COMPOSE_FILE=compose.yaml:compose.dev.yaml' >> .env
docker compose up -d db api mail
pnpm install
pnpm dev
```

Vite serves each app with its own proxy pointing `/api` at the API, so the
session cookie behaves the same as it does in production.

```
pnpm check      # lint, typecheck, test
```

Tests that need a database read `DATABASE_URL` and skip with a message when it
is not set. The door service tests run against a fake controller that speaks the
real wire protocol, so they need no hardware.

## What is in here

```
apps/members     profile, cards, certifications, dues, door controls, sign in
apps/signup      join: account, waiver, tier, what happens next
apps/admin       directory, member detail, access, audit

packages/ui          the design system: tokens, the marks, the components
packages/schema      the tables, the request and response schemas, the types
packages/api-client  a typed client over those schemas

services/api     Hono and better-auth. The only thing that writes to Postgres.
services/door    the door controller adapters and the reconcile loop.
                 Runs on the lab LAN. Holds the controller password.

docs/            architecture, the verified legacy facts, operations, decisions
infra/           the Caddy config and the lab host's compose file
tools/           backup, restore, the restore drill, the import, the voice check
```

TypeScript throughout. One pnpm workspace, one Postgres.

## The two things that must not break

**The door keeps working.** The controller holds its own card table in EEPROM.
When this system, the network or the internet is down, physical cards still open
the building. Only remote control and syncing pause.

**One URL cannot change.** The lab website and an ESP8266 status LED both read
`/space_api.json` for the open and closed indicator. Its payload is a contract
with things outside this repository, and parity gets proven on a test hostname
before the hostname moves.

## Before contributing

Read `CONTRIBUTING.md`. It is short and it binds. The parts people miss most
often: no em dashes, no emoji, no model attribution in commits, and comments that
explain why rather than what.

`docs/legacy-system.md` records what the production database and the Rails and
firmware sources actually say, checked against a restored dump rather than taken
from the planning documents. Where any other document disagrees with it, it wins.

`docs/operations.md` covers deploying to a real host, backups, and what to check
when something is wrong.

## Licence

Apache 2.0. `ATTRIBUTIONS.md` lists the dependencies and the borrowed patterns,
including the earlier HeatSync work this builds on, and the licence questions
that are still open.
