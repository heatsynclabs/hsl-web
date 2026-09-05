# Architecture

One pnpm workspace. Two services, three packages, three apps, one database.

```
apps/members     profile, cards, certifications, dues, door controls, sign in
apps/signup      join: account, waiver, tier, what happens next
apps/admin       directory, member detail, door, audit, payments
      |
      | imports types and components only
      v
packages/ui          GANTRY tokens, marks, the shared Vue components
packages/schema      Drizzle tables, Zod request and response schemas, shared types
packages/api-client  a typed fetch client over the schemas
      ^
      | imports
      |
services/api     Hono, better-auth, twenty-five routes, the only thing that
                 writes to Postgres
services/door    Hono, the DoorController adapters, the reconcile loop.
                 Runs on the lab LAN. The only holder of the controller password.
```

Dependencies point one way. An app never talks to Postgres. The API never speaks
the door wire protocol.

## The two hosts

The public host runs Postgres, the API, and one Caddy container serving the three
built apps. The lab host runs the door service and nothing else.

```
                 public host                          lab LAN
  browser ---> Caddy ---> api ---> Postgres      door service ---> controller
                            ^                          |               |
                            |     outbound HTTPS only  |          readers, strikes
                            +--------------------------+
```

The door service opens the connection. Nothing reaches into the lab. See
`decisions/0005-the-door-service-is-outbound-only.md`.

When that link is down: physical cards still open the door, because the
controller holds its own card table in EEPROM. Remote control answers 503. The
public status goes stale rather than wrong. Nothing about the building depends on
the internet.

## One session

better-auth runs inside the API service at `/api/auth`. It issues one session
cookie. Because Caddy serves all three apps and proxies `/api` on the same
origin, the cookie is a plain first-party cookie: no CORS, no cross-subdomain
configuration, no OAuth handshake between our own apps.

The consent screen in the mockups belongs to a future in which an outside
application signs in with HeatSync. First-party apps never see it, so it is not
built.

## The data

Twelve tables. The member is the user row, so there is no profile table to keep in
sync.

| Table | Holds |
|---|---|
| `user` | the member: identity, contact, roles, member level, orientation, card access |
| `session`, `account`, `verification` | better-auth |
| `cards` | physical tokens. `id` is the controller slot and is never renumbered |
| `certifications` | the tool list, ten rows |
| `user_certifications` | who holds which certification, granted by whom and when |
| `payments` | recorded dues |
| `waivers` | signed liability releases |
| `audit_log` | append-only record of every privileged change |
| `door_commands` | what a member asked the door to do, waiting for the door service to collect it. The drain refuses anything that waited more than two minutes and records that it never ran |
| `door_events` | what the door did, and the last status the controller reported |

`user_certifications` is a join table rather than an array column because the
mockup shows a granted date and a grantor, and the legacy database has 415 rows
carrying exactly that. Flattening it would throw the data away.

## The route surface

Everything the apps need and nothing speculative.

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/healthz` | everyone | liveness. Deliberately does not check Postgres |
| POST | `/api/auth/sign-in/email` | everyone | better-auth |
| POST | `/api/auth/sign-out` | everyone | better-auth |
| POST | `/api/auth/request-password-reset` | everyone | better-auth |
| POST | `/api/auth/reset-password` | everyone | better-auth |
| GET | `/api/auth/reset-password/:token` | everyone | better-auth, where the emailed link lands |
| GET | `/api/me` | member | own row, cards, certifications, payments |
| PATCH | `/api/me` | member | own contact fields and per-field visibility |
| POST | `/api/signup` | anyone | create an account, record the waiver and chosen tier |
| GET | `/api/members` | oriented | directory of members who are not hidden |
| GET | `/api/members/:id` | admin | one member in full |
| PATCH | `/api/members/:id` | admin | roles, member level, card access, orientation. Audited |
| POST | `/api/cards` | admin | assign a card to the lowest free slot under 200. Audited |
| PATCH | `/api/cards/:id` | admin | relabel, deactivate, reassign. Audited |
| GET | `/api/certifications` | member | the tool list |
| POST | `/api/members/:id/certifications` | instructor | grant. Audited |
| DELETE | `/api/members/:id/certifications/:slug` | instructor | revoke. Audited |
| POST | `/api/payments` | accountant | record a payment. Audited |
| DELETE | `/api/members/:id` | admin | remove an account nobody has used. Refused for one with any history. Audited |
| GET | `/api/audit` | admin | who changed what, newest first |
| GET | `/api/door/unknown-cards` | admin | cards seen at a reader that no card row claims |
| GET | `/api/door/card-table-view` | admin | what the controller is believed to hold, slot by slot |
| GET | `/api/door/events` | admin | the door's own history |
| POST | `/api/door/sync` | admin | push the card table now rather than on the next pass. Audited |
| POST | `/api/door/control` | member with card access | open, lock, unlock, arm, disarm |
| GET | `/api/door/status` | member | the last status the door service posted |
| GET | `/space_api.json` | public | the payload the lab website and the status LED read |

Three more exist only for the door service and authenticate with a shared
credential rather than a session: `GET /api/door/card-table` for the table it
should reconcile to, `POST /api/door/report` for status and events, and
`GET /api/door/commands` for the commands a member asked for while it was
between passes. The door service names them in `services/door/src/link.ts`.

better-auth mounts about thirty endpoints under `/api/auth`. `app.ts` serves
the five above and answers 404 for the rest, because two of the others write to
the member row past the contracts in `@hsl/schema`. The list is
`SERVED_AUTH_PATHS` in `services/api/src/auth.ts`, and that is the one place to
edit when an app needs another one.

## The door adapter

The door service holds the one abstraction in the codebase.

```ts
export interface DoorController {
  status(): Promise<DoorStatus>
  open(door: Door): Promise<void>
  setLock(door: Door | 'all', locked: boolean): Promise<void>
  setAlarm(armed: boolean): Promise<void>
  writeCard(slot: number, permissions: number, tag: string): Promise<void>
  clearCard(slot: number): Promise<void>
  readLog(): Promise<DoorLogEntry[]>
  clearLog(): Promise<void>
}
```

`services/door` implements this as `DoorAdapter`, which adds the two reads the
admin card table screen needs, `readCardTable` and `readCard`.

The HTTP API above the interface is permanent. The adapter below it is whatever
the lab owns this year. Today that is `openaccess-arduino`, which speaks the
query string protocol recorded in `legacy-system.md`. `fake` implements the same
protocol in memory for development and for CI, and every test runs against it.

Policy lives above the adapter, never inside it. The rear unlock ban from the
2018 lab decision is a check in the control route, so it holds no matter which
hardware is underneath.

## What is deliberately not here

No identity product to operate. No PostgREST or policy layer, because a table of
explicit routes is easier to read than a policy engine. No approval queue, per
`decisions/0008-single-admin-plus-audit-log.md`. No payment integration: signup
records what a member chose and the existing offline rails collect the money. No
OpenAPI document until something outside this repository needs one. No MAC
presence tracking and no resource inventory, both of which the legacy system
carries and neither of which the mockups show.
