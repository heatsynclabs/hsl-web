# Handoff

Where this stands, what is proven, and what the next person has to decide. One
page, kept current. If it disagrees with anything else, fix one of them.

Last updated 2026-09-02.

## 1. State

Nothing is deployed. Nothing in production has been touched. The whole system
runs on a laptop under Docker Compose, and `README.md` is the instructions.

| Part | State | Proven by |
|---|---|---|
| `packages/schema` | built | 26 tests, 4 migrations applied to a real Postgres |
| `packages/ui` | built | 28 tests, rendered in a browser in both themes |
| `packages/api-client` | built | 14 tests |
| `services/api` | built | 198 tests against a real Postgres |
| `services/door` | built, never spoken to hardware | 125 tests against a fake controller |
| `apps/members` | built | 55 tests, walked through in a browser |
| `apps/signup` | built | 33 tests, walked through in a browser |
| `apps/admin` | built | 166 tests, walked through in a browser |
| `tools/import` | built, run against the real dump | 23 tests, plus the run in section 2 |
| Compose stack | runs | brought up from nothing, every URL answers |
| Backup and restore | works | `tools/restore-drill.sh` passes, in CI |
| Deployment | not started | no host exists yet, see section 5 |

645 tests. Lint, typecheck and the voice check are clean.

14,468 lines of TypeScript, Vue and build scripts, and 9,355 lines of tests,
fixtures and harnesses, counted across `apps`, `packages`, `services` and
`tools` with build output excluded. 22 routes, 13 ADRs. The previous attempt was
50,941 lines and deployed nothing; the difference is almost entirely enforcement
machinery that is not here on purpose.

## 2. What has been proven against real data

The production dump was restored, the import was run against it, and the result
was checked. This is the part that matters, because two previous rewrites never
got here.

- The backup restores. `pg_restore` exit 0, no errors.
- Every row reconciles: 1,061 members, 1,030 credentials, 64 cards, 63 members
  with card access, 10 certifications.
- All 1,030 bcrypt hashes are byte identical between the two databases.
- All 64 card slots come across unchanged, 14 through 200.
- Every account row carries the three fields better-auth 1.7.2 filters on.
- A real imported member signs in through the real API and reads their own
  record.
- Six refusals hold on real data: a member cannot read another member, reach the
  directory unoriented, change another member, make themself an admin, open a
  door without card access, or read the audit log.

## 3. The audit, and what it found

Eight reviewers went at the finished system from different angles: a volunteer
at 2am with a door that will not open, a new contributor adding a feature, a
security reviewer, a maintainer in 2029, an accessibility reviewer, somebody
running a different hackerspace, a board member, and a senior engineer looking
for unearned complexity. Every finding above minor was then given to a second
agent told to refute it. Thirteen survived.

Fixed, each with a test watched failing first:

1. **Two ways into the building.** The 2018 decision refusing a remote rear
   unlock was enforced by comparing against the literal string `unlock-rear`,
   and the sibling command `unlock` walked past it and released every door. The
   Rails app being replaced has the same hole. The refusal is now a list in
   `@hsl/schema` keyed by effect, read by both services.
2. **A revoked card kept working.** Slot ownership was process memory that
   started empty at boot, so a card revoked while the door service was down was
   reported rather than cleared, forever. Ownership now comes from the database.
3. **The lint gate had never run.** The root script was `pnpm -r lint` and no
   package defines a `lint` script, so it printed a notice and exited zero. It
   caught four real problems the moment it was connected.
4. **`drizzle-kit generate` could not run.** Migration snapshot 0002 was a byte
   copy of 0001, so two snapshots claimed the same parent. The next person to
   change a table would have been stuck.
5. **A door report with a bad clock pinned the status.** A timestamp years ahead
   became the newest status permanently, and a future time is always inside the
   staleness window, so every screen went on saying the door had just reported.
   Clamped on write, and the read is bounded too, because `door_events` refuses
   deletes by design and a poisoned row could not be removed through the
   application.
6. **Contrast.** The theme toggle border measured 1.38:1 and the focus ring on a
   picked signup tier was amber drawn on amber. The wider contrast finding did
   not reproduce: measured against rendered pixels rather than tokens, labels,
   headers and notes are 5.30:1 in the light theme.
7. **The 2am checklist** sent a volunteer to two commands that are no-ops on the
   host they were standing on, and left out the Caddy log, which is the only one
   that names which layer is down.
8. **A vulnerable esbuild** arrived transitively through drizzle-kit's deprecated
   `@esbuild-kit` packages. Not reachable here, since nothing starts esbuild's
   development server, but overridden anyway.

The five that were confirmed and left open in the first pass are also fixed:

9. **The door command queue was an array in the API process.** A deploy dropped
   every waiting command while the audit log said they were queued, and a command
   that outlived an outage came back hours later and unlocked a door with nobody
   in the building. They are rows now, and the drain refuses anything that waited
   more than two minutes and records that it never ran.
10. **Password reset had no second half.** The link in the email reached a route
    the members app did not render, which mattered most to the 31 imported
    members for whom reset is the only way in. The whole loop was then walked end
    to end against the running system.
11. **A signup could not be undone.** An admin can now remove an account nobody
    has used, and is refused for one with a card, a payment, a certification, a
    signed release, an orientation, a role or any audit history.
12. **Rate limiting was better-auth's default**: off outside production, 100
    requests per ten seconds when on. It is thirty sign-in requests a minute now,
    and a correct password is refused while limited so a guesser learns nothing
    from the difference. The bucket is keyed on the source address, which behind
    the lab's own NAT is one budget for everyone in the building, so the numbers
    are chosen to survive an orientation night rather than to bound one person.
13. **A fresh install could not make its first admin.**
    `make admin EMAIL=...` grants it from the host, refuses to create a member,
    and records the change with no actor, which is what somebody with a shell
    looks like in an audit log.

Two more came from using the finished screens rather than from a reviewer:

14. **A card assigned to a member without card access** succeeded, reported a
    slot, and produced a card the door service never writes. The screen now says
    it will not open the door yet and where to turn access on.
15. **A reset link opened while already signed in** bounced to the overview,
    which is right for the sign in screen and wrong for the one screen that can
    set a new password.

## 4. Facts that overrule the older documents

`docs/legacy-system.md` has the full list with sources. The ones that changed
the build:

- **One card is in slot 200.** The firmware's `addUser` accepts it, `checkUser`
  never reads it, and on an ATmega328 its bytes land on the alarm state.
- **Card matching is an exact 32 bit comparison.** The `% 32767` in the old field
  manual is the encoding the event log splits a tag with, and nothing else.
  `services/door/src/domain/reads.ts` uses it for exactly that, which is what
  makes card enrolment work.
- **Production is Postgres 8.4.20 on CentOS 6.8**, not 9.x.
- **There are no duplicate emails.** The merge step in the old plan is not needed.
- **Dues are 25, 50 and 100.** The 20, 35 and 80 figures do not match the data.
- **`member_level` maps to labels** exactly as `app/models/user.rb` does.

## 5. Decisions somebody has to make

These block deployment, not development. None is technical.

1. **Which machine runs this.** `hsl-web` is 32 bit CentOS 6.8 on kernel 2.6.32
   and cannot run Docker at all. This is the single biggest risk to the project.
2. **Whether the board sanctions this rewrite.** A recorded position from
   2026-05-17 says the lab "already decided to not go with yet another bespoke
   one-off platform". Nobody has confirmed a board position either way.
3. **Sign-off on dropping two-admin approval**, recorded in
   `docs/decisions/0008-single-admin-plus-audit-log.md`.
4. **An SMTP account.** The API refuses to start on https without one.
5. **Waiver retention and the under-18 path.** No legal input yet.
6. **Whether `open-rear` is covered by the 2018 decision.** It pulses the strike
   for five seconds rather than holding the door open, so it is deliberately
   allowed. If the board reads the decision the other way it is one line in
   `REFUSED_DOOR_COMMANDS` and the refusal takes effect in both services.

## 6. Unknowns that need somebody at the lab

Nobody has been in front of the controller. Each is a five minute job with LAN
access and each one changes code.

1. **Dump the card table with `?a`.** Confirms whether slot 200 is really on the
   device, and whether tags are stored upper or lower case.
2. **Which physical door is controller door 1.** Getting it wrong opens the
   wrong door.
3. **Whether the deployed firmware is the DEBUG build.** If not, `dumpUser`
   prints asterisks and readback verification is impossible.
4. **The live `PRIVPASSWORD`, controller IP and MAC.** The committed `0x1234` is
   the public example value.
5. **Whether `user_certifications` holds a duplicate pair.** No unique constraint
   was added because section 13 forbids one that rejects existing data.

## 7. Known gaps in what is built

Beyond section 3. None of these is hidden in the code.

- The door service has never spoken to real hardware. Every test runs against a
  fake that speaks the same wire protocol through the same codec.
- No deploy workflow. Deployment is four lines by hand in `docs/operations.md`.
- A stack trace from either service points into a bundled file rather than into
  a source file. `docs/decisions/0013-services-ship-as-a-bundle.md` says why,
  and rebuilding the same commit gives the same line numbers.
- The admin app still reaches one better-auth path by hand.
  `apps/admin/src/App.vue` posts to `/api/auth/sign-out` with `fetch`. ADR 0012
  moved the members app onto better-auth's own client and stopped there, because
  the client costs 28.94 kB in a browser bundle and the admin app is used by a
  handful of people. The path is named in a comment beside it.
- A member whose stored skills answer is longer than `longText` accepts cannot
  shorten it through the profile form without retyping, because the box now
  stops at 2,000 characters. Nothing on the import path bounds that column, so
  such a row can exist. Everything else on their profile still saves.

## 8. Open licence questions

Read from the source files, not assumed. `ATTRIBUTIONS.md` has the detail.

- **`Open_Access_Control_Ethernet` has no licence at all.** The lab should put
  one on its own firmware.
- **GANTRY has no declared licence.** The tokens and all 29 marks came from it.
- **The Rails app is CC BY 3.0**, a content licence rather than a software one.
- This repository declares Apache 2.0 and has no LICENSE file.

## 9. If you are picking this up

Read in this order: `README.md`, `CONTRIBUTING.md`, `docs/architecture.md`,
`docs/legacy-system.md`. The ADRs explain why things are the way they are, each
with the one condition that would flip it. `docs/build-an-app.md` is for anybody
adding something members sign in to.

Then run it. `make up && make seed` takes a few minutes and what you end up
looking at is the actual system.

The previous three attempts died on the members side, not the door. The members
side is built, audited, and works. What is left is a machine to run it on and a
decision to run it.
