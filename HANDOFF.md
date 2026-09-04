# Handoff

Where this stands, what is proven, and what the next person has to decide. One
page, kept current. If it disagrees with anything else, fix one of them.

Last updated 2026-09-03.

## 1. State

Nothing is deployed. Nothing in production has been touched. The whole system
runs on a laptop under Docker Compose, and `README.md` is the instructions.

| Part | State | Proven by |
|---|---|---|
| `packages/schema` | built | 26 tests, 4 migrations applied to a real Postgres |
| `packages/ui` | built | 28 tests, rendered in a browser in both themes |
| `packages/api-client` | built | 14 tests |
| `services/api` | built | 198 tests against a real Postgres |
| `services/door` | built, never spoken to hardware | 145 tests, 12 of them over a socket against a simulated board |
| `apps/members` | built | 66 tests, walked through in a browser |
| `apps/signup` | built | 33 tests, walked through in a browser |
| `apps/admin` | built | 181 tests, walked through in a browser |
| `tools/import` | built, run against the real dump | 23 tests, plus the run in section 2 |
| Compose stack | runs | brought up from nothing, every URL answers |
| Backup and restore | works | `tools/restore-drill.sh` passes, in CI |
| Deployment | not started | no host exists yet, see section 5 |

691 tests. Lint, typecheck and the voice check are clean.

14,939 lines of TypeScript, Vue and build scripts, and 9,965 lines of tests,
fixtures and harnesses, counted across `apps`, `packages`, `services` and
`tools` with build output excluded. 22 routes, 14 ADRs. The previous attempt was
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

### The second review

The work that closed section 7 was reviewed the same way on 2026-09-03: eight
reviewers, and every finding above minor handed to two more agents told to
refute it, one by reproducing it and one by hunting for the guard elsewhere.
Thirteen survived and are fixed in `6118cc6`. Two are worth carrying forward.

16. **The boundary gate had never enforced anything.** `eslint-plugin-boundaries`
    resolved nothing for a relative import written without a file extension,
    which is how most of this repository is written, so an app importing
    straight from a service passed lint in silence. Section 5 of
    `CONTRIBUTING.md` was unenforced from the beginning, the same shape as
    finding 3. The resolver is configured now, both directions are reported, and
    the tree passes.
17. **Most of the rest were tests that would have passed against broken code.**
    The door panel asserted one of its five commands, so rewiring every button
    to send `open-front` left all 157 tests green. Sign in never asserted the
    password reached the request body. Card deactivation never proved which slot
    it sent. Each is covered now, and each was watched failing against a named
    mutation of the source.

The bundling and the images were probed hardest and came back clean: every entry
point runs from the built image, every `require` in the emitted files resolves
to a Node builtin, nothing about the build machine is baked in, and the bundles
are byte reproducible.

### The firmware, read at last

Nobody had read `Open_Access_Control_Ethernet.ino` itself. It was fetched on
2026-09-03 at commit 60e499c and read against this codebase, and it found three
defects that would each have fired on the first day against real hardware. None
was catchable before, because the in-memory board answered a dialect that
matched neither the firmware nor the parser.

18. **The card table dump was parsed with a regex the board can never match.**
    `dumpUser` prints `slot`, mask, then tag, tab separated and unpadded. The
    codec expected `NNN: tTTTTTTTT pMMM`. The blast radius written beside that
    assumption was exact: reconcile would have read an empty card table and
    rewritten all 64 cards every minute forever, clearing nothing.

    That is worse than waste. `addUser` calls `EEPROM.write` unconditionally,
    firmware line 1463, rather than the `update` that skips an unchanged byte,
    so every pass spends a write cycle on all five bytes of all 64 cards.

    ASSUMPTION: the ATmega328's EEPROM is rated near 100,000 write cycles.
    CONFIRM BY: the ATmega328P datasheet, EEPROM endurance.
    BLAST RADIUS: at 1,440 passes a day that region wears out in something like
    two months, after which cards cannot be stored and nobody gets in. It would
    present as a dead controller rather than as a software fault, so nobody
    would look here for the cause.
19. **Every status poll would have thrown.** The board prints `authok` before it
    runs a chained command, so the body is not a JSON document and
    `JSON.parse` over the whole of it fails. The door screens would have read
    Unknown forever while the door itself worked.
20. **A write to slot 200 reported success.** The board answers
    `Bad user number!` in the readback position and the body still contains
    `cur`, which is the substring the adapter took for acceptance.

Two more, smaller: the password must be the four hex characters the board reads
after `e=`, so the sketch's own `0x1234` would have been read as `0x12` and
failed every request with nothing to say why; and the door service bound its
port to the container's loopback, so the health check in `docs/operations.md`
could never have answered on the lab host.

`docs/legacy-system.md` now carries the response formats it never had, which is
why the first version had to guess.

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

1. **Dump the card table with `?a`.** The format is now read from the firmware
   and no longer a guess, so this confirms three narrower things: whether slot
   200 is really on the device, whether tags come back upper or lower case, and
   whether the deployed board answers the way this build does at all. The
   repository has not been pushed since 2013 and nothing here records a version
   read off the device.
2. **Which physical door is controller door 1.** Getting it wrong opens the
   wrong door.
3. **Whether the deployed firmware is the DEBUG build.** Check this before
   anything else. `dumpUser` prints the tag only when `DEBUG` is 2, firmware
   line 105, and prints `********` otherwise. On such a board the card table
   dump cannot be parsed, which is finding 18's failure exactly: reconcile reads
   an empty controller and rewrites all 64 cards every minute forever. The
   reconcile loop as designed does not work against a board built any other way,
   and knowing that costs one `curl`.
4. **The live `PRIVPASSWORD`, controller IP and MAC.** The committed `0x1234` is
   the public example value, and the value to configure is the four hex
   characters on their own, `1234`, not the C literal. The door service refuses
   to start on anything else.
5. **Whether `user_certifications` holds a duplicate pair.** No unique constraint
   was added because section 13 forbids one that rejects existing data.

## 7. Known gaps in what is built

Beyond section 3. None of these is hidden in the code.

- The door service has never spoken to real hardware. It now speaks to a
  simulated board over a real socket, which is what caught findings 18 to 20,
  but that board answers the bytes this repository read out of the firmware and
  therefore agrees with that reading by construction. See
  `docs/decisions/0014-a-simulated-controller.md`.
- **Nothing anywhere sets a network timeout.** All three paths use a bare
  `fetch`: the door service to the controller in
  `adapters/openaccess-arduino/controller.ts`, the door service to the API in
  `link.ts`, and the browser to the API in `packages/api-client`. The first is
  the one that matters. Arming the alarm chirps twenty times at 300 ms, firmware
  line 517, so the board legitimately takes about six seconds to answer, and a
  board that has stopped answering leaves the request hanging on the runtime's
  default rather than on anything chosen here. The reconcile pass awaits it, so
  one hung request stalls reconciliation until it gives up. A timeout has to be
  longer than six seconds and shorter than a pass.
- Only one runbook exists, `import-the-members-database.md`, against section 10
  of `CONTRIBUTING.md`, which asks for one for anything a volunteer might do at
  2am. `docs/operations.md` covers deploying and what to look at when something
  is wrong, and there is nothing written for the cutover itself or for going
  back.
- No deploy workflow. Deployment is four lines by hand in `docs/operations.md`.
- A stack trace from either service points into a bundled file rather than into
  a source file. `docs/decisions/0013-services-ship-as-a-bundle.md` says why,
  and rebuilding the same commit gives the same line numbers.
- The admin app still reaches one better-auth path by hand.
  `apps/admin/src/App.vue` posts to `/api/auth/sign-out` with `fetch`. ADR 0012
  moved the members app onto better-auth's own client and stopped there, because
  the client costs 28.94 kB in a browser bundle and the admin app is used by a
  handful of people. The path is named in a comment beside it.
- The `current_skills` and `desired_skills` columns are unbounded `text`, the
  response contract has no maximum and the import copies what Rails held, but
  the request contract caps both at 2,000 characters. So the import can write a
  row the profile form cannot send back unchanged. Nothing breaks: the form
  sends only what changed, and a member over the limit can delete characters and
  save, which was checked in a browser against a planted 2,005 character value.
  The import preflight reports the rows so nobody meets one by surprise.

- **A deploy can swallow every password reset silently, and the runbook says it
  cannot.** `make secrets` writes `smtp://mail:1025` into `secrets/smtp_url`,
  the development mail catcher. The guard in `services/api/src/config.ts` only
  checks that `SMTP_URL` is defined, and that placeholder is defined, so it
  passes. The `mail` service in `compose.yaml` carries no profile, so mailpit
  starts on the public host too and the SMTP connection succeeds. A deploy where
  somebody ran `make secrets` and did not replace that one file therefore starts
  cleanly on https, answers every reset request with success, and posts every
  email into a web inbox nobody reads. The 31 imported members for whom reset is
  the only way in are locked out with nothing in any log to say so.
  `docs/operations.md` asserted that the API refuses to start in exactly this
  case, which it does not; that sentence has been corrected rather than the
  code. The fix is two small changes: refuse an `smtp://mail:` URL when the
  origin is https, and put the mail service behind a compose profile.
- `/space_api.json` has never been proven byte for byte against the live one.
  `README.md` says parity gets proven on a test hostname before the hostname
  moves, and nothing does that yet. The lab website and an ESP8266 status LED
  both read it, and neither is in this repository.

## 8. Open licence questions

Read from the source files, not assumed. `ATTRIBUTIONS.md` has the detail.

- **`Open_Access_Control_Ethernet` has no licence at all.** The lab should put
  one on its own firmware.
- **GANTRY has no declared licence.** The tokens and all 29 marks came from it.
- **The Rails app is CC BY 3.0**, a content licence rather than a software one.
- This repository is MIT, and `LICENSE` now holds the text. It was declared
  Apache 2.0 with no licence file until 2026-09-03.

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
