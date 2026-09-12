# Architecture

The route table lives in `README.md`, because it is the system. This file is the
rest of the shape: who may call what, what the thirteen tables are for, and the
four places where a decision was made that a reader would otherwise have to
reverse engineer.

## Identity

### Members are users

There is no separate user table and no profile table. One row is the member, the
login and the identity. Nothing to keep in sync.

### Passwords

Argon2id for anything written from now on, at the library's defaults, which are
the OWASP recommendation: 19 MiB, two passes, one thread.

The existing HeatSync database holds 1,030 bcrypt hashes at cost 10 with the
`$2a$` prefix, written by Devise, and 31 empty values. Those import verbatim and
nobody resets anything. On the first successful sign-in the bcrypt hash is
verified and immediately replaced with Argon2id, in `api/src/auth.ts`.

`PEPPER` is an environment variable defaulting to the empty string, which
reduces the bcrypt branch to plain bcrypt at no cost. It exists so that a pepper
discovered later in the legacy configuration is a config change rather than a
forced reset for a thousand people.

The 31 accounts with no password get a member row and no credential. They could
not sign in before either. They use password reset.

### Sessions

Opaque tokens, 32 bytes from `crypto.randomBytes`, base64url, the primary key of
`sessions`. Not JWTs, so a session is revoked by deleting a row.

```
Name:     hsl
Domain:   COOKIE_DOMAIN, the apex
HttpOnly: true
Secure:   true on https
SameSite: Lax
Max-Age:  30 days
```

Scoped to the apex domain, so every HeatSync app on a subdomain shares one login
with no protocol, no redirects and no configuration. Sliding: any authenticated
request whose session expires within 7 days pushes it back out to 30.

`api` is stateless because sessions live in Postgres. Redeploy at any moment and
nobody is logged out.

### Tokens for anything that is not a browser on the domain

`POST /api/token` exchanges a session for a one hour RS256 JWT.

```json
{ "iss": "https://api.heatsynclabs.org",
  "sub": "<member uuid>",
  "name": "...",
  "roles": ["admin"],
  "exp": 1757600000 }
```

Signed with one RSA key, public half at `/.well-known/jwks.json` under
`kid: hsl-1`. Any other HeatSync service, in any language, verifies locally
without calling back.

No refresh tokens. The client holds the session cookie and asks for another
token, which is why the token route takes the `session` guard rather than the
`member` one: a JWT cannot buy another JWT.

Only the subject is trusted out of a presented token. Roles and status are read
from the member row on every request, so a suspension takes effect before the
hour is up.

Rotation is publishing both keys under different `kid` values, signing with the
new one, and dropping the old after an hour.

### Service tokens

Machines do not have sessions. The door service, a kiosk, the status sign, a
cron script: each gets a row in `service_tokens`.

Presented as `Authorization: Bearer <id>.<secret>`. The id prefix makes the
lookup a primary key hit rather than a hash comparison against every row. The
secret is 32 random bytes, shown once at creation, stored as an Argon2 hash.

Scopes are a text array checked by exact match.

```
door            the six door-service endpoints
members:read    directory, for a kiosk
status:read     space_api, if it is ever locked down
```

A compromised door controller holds a credential that can do one thing, and
revoking it is a row update rather than a redeploy.

### Roles

`members.roles` is a text array. Three values, additive, not a ladder, plus the
absence of all of them.

| Role | Grants |
| --- | --- |
| `admin` | everything |
| `instructor` | grant and revoke certifications |
| `accountant` | record payments |
| (none) | own profile, own cards, own certifications, own payments, own door events |

Two attributes rather than roles: `oriented_on` gates reading the member
directory, and `hidden` keeps a member out of it. Orientation is stored as the
date it happened rather than as a flag, because the legacy database records when
and a boolean throws that away.

`door_access` is a third boolean and is the whole of the door policy. Sitting
next to it is a card list contract that is per-door, so a future controller can
express more, but today the answer is yes or no.

### Guards

Six middlewares in `api/src/auth.ts`. The name on a route in `index.ts` is the
complete statement of who may call it, and each guard is self-sufficient rather
than stacked.

| Guard | Passes when |
| --- | --- |
| `session` | A session cookie, and `status = 'active'` |
| `member` | Valid session or JWT, and `status = 'active'` |
| `role('admin')` | As above, and `roles` contains it. `admin` carries the other two |
| `oriented` | As above, and `oriented_on` is set |
| `doorAccess` | As above, and `door_access` is true |
| `service('door')` | Valid service token holding that scope |

No policy engine, no permissions table, no rules in the database. A seventh rule
is a seventh middleware, nine lines long.

### Rate limiting

`POST /api/login` and `POST /api/forgot`: ten attempts per IP and ten per email
per fifteen minutes, counted in memory. One process serving a hackerspace does
not need Redis, and losing the counters on a redeploy costs one window.

Over the limit returns 429 with no hint about whether the account exists. A
failed login returns the same message and takes a comparable time whether the
email exists or not, by verifying against a fixed dummy hash when it does not.

## The thirteen tables

`migrations/001_init.sql` is the whole schema and is worth reading in full. What
is not obvious from it:

**`members`** carries `legacy_id` so a row can be traced back to the Rails
database for a year after cutover, and `reset_token` rather than a reset table,
because one live token per member is the correct behaviour anyway.

It also carries five columns the specification's table does not: `oriented_on`,
`postal_code`, `emergency_email`, `email_visible` and `phone_visible`. All five
hold data the legacy `users` table holds, and the last two are the reason the
directory is allowed to show an address at all. `docs/decisions/0013` has the
reasoning.

**`credentials.token`** is the card id. It has no length constraint, no case
rule and no hardware format. Legacy tokens are five to seven hex characters, and
whatever normalisation a controller needs is the adapter's business. A card is
never hard deleted, because `door_events` references the token and the history
has to stay readable.

**`member_certifications`** is a join table rather than an array column because
the grant carries a date and a grantor, and the legacy database has 415 rows
carrying exactly that.

**`audit_log`** and **`door_events`** are append-only, enforced by a trigger
rather than by convention. The trigger function names `TG_TABLE_NAME` rather
than a literal, because one function serves two tables and blaming the wrong one
tells whoever hit it something false.

**`door_state`** is upserted, never appended. Its `reported_at` is this API's
clock rather than a time the door service sent, because staleness is how long
since this side heard from a controller, and a lab host with a skewed clock
would otherwise read as permanently fresh or permanently stale. A report is also
the whole truth about its controller: a door it no longer names is deleted, so
renaming one cannot leave a row behind that makes the rest look stale forever. The legacy system wrote a status
snapshot into its event log on every poll and reached 2,868,091 rows, of which
2.8 million were snapshots. This schema cannot do that. It also carries
`capabilities`, which is controller wide and repeated on each of that
controller's rows: it costs one array per door and saves a fourteenth table.

**`door_placements.placement`** is the only column in the database the API is
forbidden to read. `api/src/db.ts` configures the column name transform and
deliberately not the value transform, because the shipped `postgres.camel` also
rewrites the keys inside every jsonb value, and renaming a placement's keys
would be reading it.

The `on delete cascade` on `door_placements` is load bearing. Revoke a
credential, the placement goes with it, and the next pass sees a card on the
device that nothing claims and clears it. That is the revoke-then-restart bug
solved by a foreign key.

## The card list version

Commands are handed over in the order they were asked for. `returning` makes no
promise about row order, and two commands run backwards is a door left locked
when somebody asked for it to be open.

`GET /door/commands` hands back a version with every claim, and the door service
fetches the card list only when it changes. An idle lab is one small request
every five seconds and nothing else.

The version is a digest of the card list itself, not a counter. A counter
somebody has to remember to bump is a counter somebody forgets, and there is no
sync endpoint to paper over it: an admin change changes the list, which changes
the digest, and the next tick picks it up. The legacy system had an upload-all
button an admin had to remember to press.

The placement is deliberately not in the digest. The adapter writes placements
itself, so including them would make every pass change the version it had just
answered.

## The audit mechanism

Discipline does not work. Privileged writes go through one helper in
`api/src/audit.ts` that takes the audit fields as required arguments and runs
both writes in one transaction.

```ts
await change(
  { actor: me.id, action: 'member.update', target: id, detail: { fields: Object.keys(patch) } },
  (tx) => tx`update members set ${sql(patch)} where id = ${id}`,
)
```

A privileged write with no audit row is not something a reviewer has to catch.
There is no way to express it, and a write that fails rolls the audit row back
with it.

`GET /api/audit` reads it back, admin only, newest first. A log nobody can read
does not make anything visible, and visibility is the whole argument for letting
one admin act immediately.

A write that changes nothing writes nothing. Revoking a card that is already
revoked answers 404 and leaves no row, because an entry for something that did
not happen is worse than no entry at all.

The complete list of actions. If an action is not here, no route writes it.

```
member.create      member.update      member.delete      member.signup
member.reset
cert.grant         cert.revoke
credential.issue   credential.revoke
payment.record
door.command       door.command.refused
service_token.create   service_token.revoke
```

## The door service

### Shape

One process on the lab VLAN. No HTTP server except a health check bound to
localhost. It is a loop that makes outbound HTTPS calls to `api` and speaks
whatever the controller speaks.

It reaches out because the alternatives are worse. A tunnel is two configs that
must agree and fail silently and directionally. A mesh adds a control plane and
a key expiry set to fire six months after whoever configured it has moved on. An
inbound port is a public path to a network segment holding an unauthenticated
door controller.

When the link is down: cards still open the door from the controller's own
memory, the card table goes stale, remote control answers 503 honestly, and
public status goes stale rather than wrong. Nothing about the building depends
on the internet.

### The adapter interface

Seven methods and one optional eighth, in `door/src/adapter.ts`. That is what a
new controller implements and it is the whole of it.

`uploadCards` being declarative rather than a delta is the most important choice
in the design. The caller says what should be true. Every reconcile question,
what to write, what to clear, what to leave alone, what cannot be placed,
belongs to the one implementation that knows what a slot is.

An optional capability is declared, not implemented as a stub. A controller with
no alarm does not list `alarm`, and the API refuses `alarm.arm` before it is
ever queued.

### Card ids, in both directions

The API stores a card id as text with no length, case or format rule, because
rule Two says the format belongs to the adapter. So the adapter pads it on the
way to the device, and maps it back on the way out: a door event names the card
id the API issued, not the eight character form the device stores. Without that,
a card issued by hand as five hex characters would open the door and never
appear on its holder's door log.

A card id the adapter did not write has no API form and arrives as the reader
saw it, which is the value an admin copies into `POST /api/credentials`.

A card id this device cannot hold at all is a fault against that one card. It
used to be an exception out of `uploadCards`, which took the whole pass with it
on every tick, so one unusable value in the members database froze the card table
for the building.

### What the adapter owns

Everything on this list is invisible above the interface: addressing and
allocation, the free-slot search, upper bounds and any address the device
refuses; field formats, permission masks, tag padding, case, encoding and
length; wire protocol, login and logout sequencing, chained commands, response
framing, the substrings that mean success and the literals that mean failure;
device behaviour, blocking commands, retry, timeouts, a log that is a ring
buffer and must be read then cleared, a tag split across two entries by a
divisor; and build variants, including a device that will not report its own
contents and the fallback that follows from it.

### Two guards on uploadCards

Both refuse rather than act, and both emit a fault.

An empty card list never means clear the building. If the list has no cards at
all and the device holds some, report and do nothing. A database that has been
emptied or half restored is the case this exists for, and it is reachable by
accident: a reset against the wrong stack, a restore that has not finished, a
`DATABASE_URL` pointed somewhere new.

A mass clear is refused. If a pass would clear more than a small number of cards
at once, report and do nothing. The empty-list guard alone does not cover a card
list that came back with one row out of sixty-four.

### Switching controllers

The case the whole design exists to pass.

1. Write `door/src/adapters/<vendor>.ts` implementing the interface.
2. Give it a controller id and start it.
3. Run both for a week. Two controller ids, two sets of placements, one card
   list. Every member's card is written to both, and both report events.
4. Stop the old one and delete its placement rows.

Nothing in `credentials` changes. Nothing in `members` changes. No migration
touches member data. Nobody's card id changes, which matters because that number
is physically in people's pockets.

This is also why `GET /api/door` answers with an array rather than the single
object the specification sketched: for a week, there are two controllers, and a
single object cannot say that.
