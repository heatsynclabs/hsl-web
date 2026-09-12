# hsl-web

The HeatSync Labs API, identity provider and door controller service.

Two processes, two hosts, thirteen tables, thirty nine routes. There are no
front end applications here: this repository ends at the HTTP boundary.

```
  public host                                  lab VLAN
  ┌──────────────────────────────┐             ┌────────────────────────────┐
  │ caddy    TLS                 │             │ door                       │
  │ api      Hono + Postgres     │◀── HTTPS ───│   adapter + poll loop      │
  │ db       Postgres 17         │   outbound  │   stateless, no disk       │
  └──────────────────────────────┘   only      └─────────────┬──────────────┘
                                                             │
                                               ┌─────────────▼──────────────┐
                                               │ door controller hardware   │
                                               └────────────────────────────┘
```

`api` answers three questions and nothing else. Who is this person, and are they
a member in good standing. What are they allowed to do. What happened, and who
did it.

`door` is a client of `api` that happens to be holding a wire to a door
controller. It makes outbound HTTPS connections and accepts none, so nothing on
the public internet can reach the lab network.

## The four rules

Everything in this repository is a consequence of one of these.

**One.** The database stores card ids and who holds them. Where a card sits on a
particular controller is stored too, as a value the API never opens.

**Two.** Only the adapter knows what the hardware is. The API has no concept of
a slot, a permission mask, a padded tag, a wire protocol or a device quirk.

**Three.** Physical cards open the door when everything in this repository is
down. The controller holds its own card table, so a dead API, a dead link or a
dead lab host is an inconvenience and never a lockout.

**Four.** Every privileged change writes an audit row in the same transaction.
Not beside it. In it.

## Run it

Node 24 and Docker. `make` on its own lists every target.

```sh
make install     # dependencies for the scripts, the API and the door service
make secrets     # writes .env with a database password
make up          # Postgres and the API
make migrate     # build the schema
make seed        # invented development data, obviously invented
```

Then sign in as `ada@example.invalid` with the password
`correct-horse-battery`, which is in `scripts/seed.sql` and is not a secret.

```sh
curl -i localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.invalid","password":"correct-horse-battery"}'
```

To drive the door service without hardware, start the simulated controller and
point the door service at it. `docs/runbooks/run-the-door-service.md` is the
whole sequence, including the service token.

```sh
make simulator
```

## Test it

```sh
make check       # type check both services, then run both suites
```

The suites need the Postgres from `make up`, because most of what is worth
testing here is a refusal expressed in SQL: a foreign key, a unique index, an
append-only trigger, a transaction that has to roll two writes back together.
There is no test framework. `node --test` is the runner and `node:assert` is the
assertion library.

The door suite needs nothing. It runs the real adapter and the real codec
against a simulated board that answers the bytes the firmware answers, over a
real socket. See `docs/decisions/0007-a-simulated-controller.md`.

## The routes

The list below is `api/src/index.ts`, which is nothing but this table in code.
If a route is not there, the system does not do that.

### Session and identity

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| POST | `/api/login` | none | Email and password in, session cookie out |
| POST | `/api/logout` | session | Delete this session |
| POST | `/api/forgot` | none | Email a reset link. Always answers 204 |
| POST | `/api/reset` | reset token | Set a password from an emailed token |
| POST | `/api/password` | member | Change own, requires the current one |
| POST | `/api/token` | session | One hour RS256 JWT |
| GET | `/.well-known/jwks.json` | none | Public signing key |
| GET | `/healthz` | none | Liveness. Deliberately does not check Postgres |

### Self

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/me` | member | Own row, cards, certifications, recent payments |
| PATCH | `/api/me` | member | Own contact fields and visibility |
| GET | `/api/me/door-events` | member | Own entries and denials |

### Members

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| POST | `/api/signup` | none | Create an account, record the waiver and chosen tier |
| GET | `/api/members` | oriented | Directory of members who are not hidden. `?q=` |
| GET | `/api/members/:id` | admin | One member in full |
| POST | `/api/members` | admin | Create. Audited |
| PATCH | `/api/members/:id` | admin | Roles, level, status, orientation, door access. Audited |
| DELETE | `/api/members/:id` | admin | Refused for an account with any history. Audited |
| POST | `/api/members/:id/reset` | admin | Issue a set-password link. Audited |

### Certifications

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/certifications` | member | The tool list |
| POST | `/api/members/:id/certifications` | instructor | Grant. Audited |
| DELETE | `/api/members/:id/certifications/:slug` | instructor | Revoke. Audited |

### Credentials

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/credentials` | admin | All cards with member names and placement status |
| POST | `/api/credentials` | admin | Issue a card to a member. Audited |
| DELETE | `/api/credentials/:id` | admin | Revoke. Sets `active` false, never deletes. Audited |

### Payments

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/members/:id/payments` | admin | That member's payments |
| POST | `/api/payments` | accountant | Record one. Audited |

### Door, for people

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/door` | member | State per door, freshness, and what the controller can do |
| POST | `/api/door/command` | door access | Queue a command. Audited |
| GET | `/api/door/events` | admin | Everything the door reported |

### Service tokens

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/api/service-tokens` | admin | Which machines hold a credential |
| POST | `/api/service-tokens` | admin | Mint one. The secret is shown once. Audited |
| DELETE | `/api/service-tokens/:id` | admin | Revoke. Audited |

### Door, for the door service

Under `/door` rather than `/api`, so the auth boundary is visible in the path and
nothing a browser session reaches can touch them. Each carries
`X-Controller-Id`, which says which controller the request is about.

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/door/cards` | service `door` | The card list plus each card's placement |
| POST | `/door/placements` | service `door` | Record where cards ended up |
| GET | `/door/commands` | service `door` | Claim waiting commands, plus the card list version |
| POST | `/door/commands/:id/result` | service `door` | How one went |
| POST | `/door/state` | service `door` | Current state per door, and capabilities |
| POST | `/door/events` | service `door` | What happened |

### Public

| Method | Path | Guard | Does |
| --- | --- | --- | --- |
| GET | `/space_api.json` | none | SpaceAPI document, served from `door_state` |

### Conventions

JSON in, JSON out. Errors are always `{ "error": "a sentence a human can act
on" }` with a correct status, and there is no error code taxonomy. Timestamps
are ISO 8601 UTC. List endpoints return a bare array; paginated ones return
`{ items, next }`. Unknown fields in a body are ignored, never echoed. Every
write is safe to retry.

## Where things live

```
hsl-web/
  compose.yml            the public host
  compose.lab.yml        the lab host
  Caddyfile
  migrations/001_init.sql  thirteen tables
  scripts/
    migrate.ts           apply pending migrations
    import.ts            the one-time legacy import
    seed.sql             invented development data
    nightly.sql          expire sessions, drop old door events
    backup.sh restore.sh
  api/src/
    config.ts            every environment variable, in one place
    db.ts auth.ts tokens.ts audit.ts mail.ts log.ts http.ts
    routes/              session members certifications credentials
                         payments door service spaceapi
    index.ts             the route table above, in code
  door/src/
    adapter.ts           the interface a controller implements
    adapters/
      openaccess.ts      one controller, all its weirdness
      fake.ts            the same bytes, in memory, and on a socket
    link.ts              the six HTTP calls to the API
    loop.ts main.ts
```

Dependencies, complete.

```
api:   hono  @hono/node-server  postgres  jose  @node-rs/argon2  bcryptjs  nodemailer
door:  undici
```

`bcryptjs` is temporary. When this reaches zero, delete the bcrypt branch in
`api/src/auth.ts` and the dependency with it.

```sql
select count(*) from members
where password is not null and password not like '$argon2%';
```

There is no ORM, no auth framework, no migration framework, no validation
library and no bundler. Request bodies are destructured and checked with `if`
statements, which at this surface area is shorter than a schema and easier to
read than a schema. TypeScript runs directly: Node 24 strips the types, so there
is no build step and a stack trace points at a line you can open.

## Deploy it

`docs/operations.md` has the whole of it. In short: `compose.yml` on the public
host, `compose.lab.yml` on the lab host, migrations run before the API restarts,
and rollback is redeploying the previous tag.

## Documentation

| | |
| --- | --- |
| `CONTRIBUTING.md` | The working rules. Read this before changing anything |
| `docs/architecture.md` | The shape, the guards, the thirteen tables |
| `docs/legacy-system.md` | What the old system actually does, verified against the dump and the firmware |
| `docs/operations.md` | Deploying, backups, logging, what breaks and what happens |
| `docs/glossary.md` | The words this codebase uses, and what they mean at the lab |
| `docs/decisions/` | Why each choice was made, and what would reverse it |
| `docs/runbooks/` | The 2am versions |
| `HANDOFF.md` | What is not done, what nobody has confirmed, and who has to decide |

## What is not built

No OIDC authorization server. Every HeatSync screen is same-origin behind one
Caddy, so the cookie is enough, and the JWKS covers services written here. When
the first piece of off-the-shelf software needs to log in, put something that
speaks the protocol beside `api` and let it be one more consumer.

No MFA. No SAML, LDAP or SCIM. No approval queue: one admin acts immediately and
the audit log is what makes it visible. No payment integration: signup records
what a member chose and the existing offline rails collect the money.
