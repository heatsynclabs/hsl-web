# Handoff

Where this stands, what is proven, and what the next person has to decide. One
page, kept current. If it disagrees with anything else, fix one of them.

Last updated 2026-09-02.

## 1. State

Nothing is deployed. Nothing in production has been touched. The whole system
runs on a laptop under Docker Compose, and `README.md` is the instructions.

| Part | State | Proven by |
|---|---|---|
| `packages/schema` | built | 26 tests, 3 migrations applied to a real Postgres |
| `packages/ui` | built | 16 tests, rendered in a browser |
| `packages/api-client` | built | 14 tests |
| `services/api` | built | 161 tests against a real Postgres |
| `services/door` | built, never spoken to hardware | 103 tests against a fake controller |
| `apps/members` | built | 38 tests, walked through in a browser |
| `apps/signup` | built | 33 tests, walked through in a browser |
| `apps/admin` | built | 73 tests, walked through in a browser |
| `tools/import` | built, run against the real dump | 23 tests, plus the run below |
| Compose stack | runs | brought up from nothing, every URL answers |
| Backup and restore | works | `tools/restore-drill.sh` passes, in CI |
| Deployment | not started | no host exists yet, see section 4 |

464 tests. Lint, typecheck and the voice check are clean across the repository.

12,368 lines of TypeScript and Vue, and 6,055 lines of tests. The previous
attempt was 50,941 lines and deployed nothing; the difference is almost entirely
enforcement machinery that is not here on purpose.

## 2. What has been proven against real data

The production dump was restored, the import was run against it, and the result
was checked. This is the part that matters, because two previous rewrites never
got here.

- The backup restores. `pg_restore` exit 0, no errors.
- Every row reconciles: 1,061 members, 1,030 credentials, 64 cards, 63 members
  with card access, 10 certifications.
- All 1,030 bcrypt hashes are byte identical between the two databases.
- All 64 card slots come across unchanged, 14 through 200.
- All 64 card numbers canonicalise to eight uppercase hex characters.
- Every account row carries `providerId: credential`, `issuer:
  local:credential`, and `accountId` equal to the member id, which is what
  better-auth 1.7.2 filters on.
- A real imported member signs in through the real API and reads their own
  record: 110 payments, 4 certifications, card slot 14, level 50.
- A member cannot read another member, cannot reach the directory without being
  oriented, cannot change another member, cannot make themself an admin, cannot
  open a door without card access, and cannot read the audit log. All six
  refused, on real data.

## 3. Facts that overrule the older documents

`docs/legacy-system.md` has the full list with sources. The ones that changed
the build:

- **One card is in slot 200.** The firmware's `addUser` accepts it, `checkUser`
  never reads it, and on an ATmega328 its bytes land on the alarm state. That
  card does not open the door today even though the members database says it
  does. The import reports it and preserves it; the door service refuses to
  write it.
- **Card matching is an exact 32 bit comparison.** The `% 32767` in the old
  field manual is a log encoding. Applying it would match the wrong card.
- **Production is Postgres 8.4.20 on CentOS 6.8**, not 9.x.
- **There are no duplicate emails.** The merge step in the old plan is not
  needed.
- **Dues are 25, 50 and 100.** The 20, 35 and 80 figures do not match the data.
- **`member_level` maps to labels** exactly as `app/models/user.rb` does, and
  `paymentStatus` is the 60 day rule from the same file.

## 4. Decisions somebody has to make

These block deployment, not development. None of them is technical.

1. **Which machine runs this.** `hsl-web` is 32 bit CentOS 6.8 on kernel 2.6.32
   and cannot run Docker at all. Until a host is named and owned, the Compose
   stack has nowhere to go. This is the single biggest risk to the project.
2. **Whether the board sanctions this rewrite.** A recorded position from
   2026-05-17 in the Slack export says the lab "already decided to not go with
   yet another bespoke one-off platform". Nobody has confirmed a board decision
   either way.
3. **Sign-off on dropping two-admin approval**, recorded in
   `docs/decisions/0008-single-admin-plus-audit-log.md`. The mockups promised it
   in member-facing copy; the apps now say what the system actually does.
4. **An SMTP account.** Password reset is the only way in for the 31 members
   with no password hash. The API refuses to start on https without it.
5. **Waiver retention and the under-18 path.** No legal input yet. The signup
   app records acceptance and points at the paper release rather than replacing
   it, which is the conservative reading.

## 5. Unknowns that need somebody at the lab

Nobody has been in front of the controller. Each of these is a five minute job
with LAN access and each one changes code.

1. **Dump the card table with `?a`.** Confirms whether slot 200 is really on the
   device, and whether tags are stored upper or lower case. The reconcile loop
   assumes uppercase and says so.
2. **Which physical door is controller door 1.** Getting it wrong opens the
   wrong door. `o1` and `u=1` are assumed to be the front.
3. **Whether the deployed firmware is the DEBUG build.** If it is not,
   `dumpUser` prints asterisks instead of tags and readback verification is
   impossible.
4. **The live `PRIVPASSWORD`, controller IP and MAC.** The committed `0x1234` is
   the public example value.
5. **Whether `user_certifications` holds a duplicate pair.** No unique
   constraint was added, because section 13 forbids one that rejects existing
   data, and nobody has checked.

## 6. Known gaps in what is built

Honest list. None of these is hidden in the code.

- The door service has never spoken to real hardware. Every test runs against a
  fake that speaks the same wire protocol through the same codec.
- The API image is 487 MB because `pnpm deploy --prod` keeps a workspace
  dependency's own devDependencies. Roughly 110 MB of build tooling ships and
  never runs. Fixing it properly means bundling the service to one file.
- There is no password reset completion screen. The link in the mail reaches a
  route the members app does not render yet.
- The members app posts to the three better-auth endpoints directly rather than
  using `better-auth/vue`, because the package is not a dependency of that app.
  The call sites name the file and line each path was read from.
- The Recent list on the door screen only shows what that browser did since the
  screen opened. There is no member-facing door event route.
- `packages/ui` has no multi-line input, so the two free text profile fields use
  single line ones.
- No deploy workflow. Deployment is four lines by hand in
  `docs/operations.md`, which is the right amount until a second person needs to
  do it.

## 7. Open licence questions

Read from the source files, not assumed. In `ATTRIBUTIONS.md` with detail.

- **`Open_Access_Control_Ethernet` has no licence at all.** No LICENSE file, no
  statement in any source file. The door service reimplements its wire protocol,
  which is ordinarily fine for interoperability, but the lab should put a
  licence on its own firmware.
- **GANTRY has no declared licence.** `new-hsl` has no licence file and no
  `license` field. The tokens and all 29 marks in `packages/ui` came from it.
- **The Rails app is CC BY 3.0**, which is a content licence rather than a
  software one. This system reimplements its schema, its member level mapping
  and its payment status rule, and credits it.
- This repository declares Apache 2.0 in `package.json` and has no LICENSE file.

## 8. If you are picking this up

Read in this order: `README.md`, then `CONTRIBUTING.md`, then
`docs/architecture.md`, then `docs/legacy-system.md`. The decisions in
`docs/decisions/` explain why things are the way they are, each with the one
condition that would flip it.

Then run it. `make up && make seed` takes a few minutes and the thing you end up
looking at is the actual system.

The previous three attempts died on the members side, not the door. The members
side is built and works. What is left is a machine to run it on and a decision
to run it.
