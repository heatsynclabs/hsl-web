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
| `packages/api-client` | built | 15 tests |
| `services/api` | built | 228 tests against a real Postgres |
| `services/door` | built, never spoken to hardware | 150 tests, 12 of them over a socket against a simulated board |
| `apps/members` | built | 66 tests, walked through in a browser |
| `apps/signup` | built | 33 tests, walked through in a browser |
| `apps/admin` | built | 181 tests, walked through in a browser |
| `tools/import` | built, run against the real dump | 37 tests, 12 needing `LEGACY_DATABASE_URL`, plus the run in section 2 |
| Compose stack | runs | brought up from nothing, every URL answers |
| Backup and restore | works | `tools/restore-drill.sh` passes, in CI |
| Deployment | not started | no host exists yet, see section 5 |

727 tests, which is what `pnpm check` runs. `tools/import` is not a workspace
package and has its own 37 and its own CI job. Lint, typecheck and the voice
check are clean.

14,939 lines of TypeScript, Vue and build scripts, and 9,965 lines of tests,
fixtures and harnesses, counted across `apps`, `packages`, `services` and
`tools` with build output excluded. 14 ADRs. The previous attempt was
50,941 lines and deployed nothing; the difference is almost entirely enforcement
machinery that is not here on purpose.

25 routes, plus the better-auth handler, which serves five paths and answers 404
for everything else it mounts.

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

### The routes nobody had counted

`services/api` authorization was attacked rather than confirmed on 2026-09-03:
privilege escalation, IDOR on `/api/members/:id`, mass assignment on both PATCH
bodies, an instructor granting to themself, the door credential, and the
append-only tables. Every route in `docs/architecture.md` held. The strict
request schemas do close the Rails `attr_accessible` defect: `admin`,
`memberLevel`, `orientation` and `cardAccess` are each refused with a 400 on
`PATCH /api/me`, and no role reached a route it should not.

The hole was beside them, on the surface nobody had listed.

21. **better-auth mounted about thirty routes and this system calls five.**
    `app.ts` handed the whole of `/api/auth/*` to `deps.auth.handler`, so every
    endpoint the 1.7.2 `emailAndPassword` configuration builds was served to the
    internet. Two of them write to the member row, which is the table the strict
    contracts in `@hsl/schema` exist to protect.

    `POST /api/auth/sign-up/email` creates a member with no waiver row, no
    waiver timestamp and no dues tier, and signs the caller in. `POST /api/signup`
    is the only code that records the release, so the one field that says whether
    a person accepted it stopped meaning anything.

    `POST /api/auth/update-user` writes `name` and `image` with no length of its
    own. Reproduced against the running stack: a signed-in member with no
    orientation, no card and no role set a 2,000,000 character name, and
    `GET /api/members` went from about a kilobyte to two megabytes for every
    oriented member who opened the directory. `PATCH /api/me` refuses the same
    name at 200 characters. `image` is a column no contract lets anyone write at
    all. A 4 MB body was accepted, and nothing in Caddy, Hono or the route sets a
    request size limit.

    `/api/auth/reset-password/../update-user` reached `update-user`, because
    nothing resolved the dot segment before the wildcard matched.

    `app.ts` now serves an allow list of the five paths this system calls, taken
    from a parsed URL so a dot segment is resolved first, and answers 404 for
    everything else. It is an allow list rather than better-auth's own
    `disabledPaths` because a deny list has to be re-read against every upgrade.
    `POST /api/signup` calls `auth.api.signUpEmail` directly, which does not go
    through better-auth's router, so joining is unaffected. Checked over real
    HTTP, not only in process.

    Each of the five served paths has a case of its own, because
    `password-reset.test.ts` drives `auth.api` and so proves the library works
    and nothing about whether a browser can reach it. Narrowing the allow list
    to sign in alone was watched failing all four of the others.
22. **The attribution gate in CI had never existed.** Section 1 of
    `CONTRIBUTING.md` said the commit message check runs locally and in CI. CI
    had four jobs and none of them read a commit message. The local half was not
    installed either: nothing in the repository sets `core.hooksPath`, so a
    fresh clone runs no hook, which was confirmed by cloning. Same shape as
    findings 3 and 16. There is a `commit-messages` job now, calling
    `.githooks/commit-msg` rather than repeating its pattern, watched refusing a
    planted `Co-Authored-By` trailer and a planted em dash and passing a clean
    message. `make hooks` enables the local half.
23. **A reassigned card left no record of who lost it.** `PATCH /api/cards/:id`
    accepts a new `userId`, and the audit row recorded the slot and the new
    owner only. `member.update` records `previous` for exactly this reason. The
    log is what stands in for two-admin approval under
    decisions/0008-single-admin-plus-audit-log.md, and it could not answer who
    held slot 38 last month. It records `previousUserId` now.

The five gates were broken on purpose and each was watched catching it:
`max-lines-per-function` at 53 lines, `complexity` at 11, `max-params` at 5 and
`max-depth` at 5 all report and `eslint` exits 1; the boundaries policy reports
an app importing a service both with and without a file extension, an app
importing `@hsl/api` by name, an app importing another app, a service importing
a service, a service importing an app, and a package importing a service; the
voice check fails `pnpm lint` on a planted emoji and a planted banned word in a
tracked file. The CI workflow's own scripts were run rather than read.

### The deployment audit

Ten dimensions on 2026-09-04, every finding above minor handed to two agents
told to refute it, one by reproducing it and one by hunting for the guard
elsewhere. Ninety-five survived. The question being asked was narrower than
before: put this Docker stack on a host, set the environment variables, and does
it work.

24. **An emptied members database erased the card table off the controller.**
    This is the one that matters. `make reset` against the wrong stack, a
    restore that has not finished, `DATABASE_URL` pointed somewhere new, or step
    13 of the import runbook all leave the members database with no card rows.
    The API answers 200 with empty arrays in every one of those cases, and a
    door service that has been running owns every slot, so the next pass
    computed a clear for all 64 and nobody's fob opened the building.

    Reproduced against `planReconcile` directly: `clears=64, slots 14..77`.
    That is gate 2 of section 13 of `CONTRIBUTING.md` failing, and not because
    this repository was down. It was up and confidently wrong, which is the
    harder failure to see.

    `planReconcile` now takes the API's own `ownedSlots` as
    `databaseIssuedSlots` and withholds every clear when it is empty. That
    distinguishes the two cases exactly: revoking a card leaves its row, so the
    slot is still named; a database with no card rows at all names nothing.
    Revoking every card in the lab still clears the controller. The pass reports
    `card-table-clear-withheld` so somebody sees it happened. Four tests, unit
    and loop level, each watched failing against a disabled guard.

    `make reset` also refuses now on a host whose `.env` says `HSL_SCHEME=https`
    unless `CONFIRM=yes`. A comment saying "local only" is not a guard.
25. **The deployment that swallows every password reset is closed.** Section 7
    recorded it and proposed the fix; this is the fix. `config.ts` refuses an
    https origin whose `SMTP_URL` host is `mail`, which is the compose service
    name of the development catcher and resolves nowhere else, so there is no
    false positive. `SMTP_URL` is also parsed rather than accepted as any
    non-empty string: nodemailer 9.1.1 recognises `smtp:`, `smtps:` and
    `direct:` and silently ignores every other scheme, so a value with no scheme
    used to fail at the first send rather than at boot. The message never
    carries the value, because the value carries the relay password.

    Two tests in the suite agreed with the defect and had to be inverted: the
    `complete` production fixture in `config.test.ts` was the mail catcher, and
    `password-reset.test.ts` asserted that `smtp://localhost:1025` on an https
    origin did not throw. The mail service is behind a `dev` profile as well, so
    it cannot start on a public host at all.
26. **Nothing set a network timeout, and the cost was measured.** Node 24.20,
    the exact tag the images pin, throws `Headers Timeout Error` after 302.4
    seconds against a server that accepts the connection and never answers.
    That is undici's default, and a wedged Arduino on a shared LAN is exactly
    that shape. The loop's `running` guard then skips every 60 second tick for
    five minutes, the API's status goes stale after two, remote control answers
    503 and the public page reads closed.

    Every one of the four shipped call sites is bounded now. The controller gets
    15 seconds, which is above the six that arming legitimately takes,
    `chirpAlarm` twenty times at 300 ms at firmware line 517, and well under a
    pass. The door service gets 10 on the API, the browser client 20, and the
    admin app's hand-written sign out 10. The controller timeout is tested
    against a real socket that accepts and never answers, and watched failing.
27. **The production members dump was baked into a Docker image layer.**
    `.dockerignore` excluded `secrets` and not `legacy`, and the documented
    import puts a `pg_dump` of the whole Rails database at
    `legacy/members.dump`. `COPY . .` in the service Dockerfile carried it into
    the image. Confirmed by building the `tools` target and listing `/repo`,
    which held `legacy/` and `.env`. Git history was clean and stayed clean;
    this was the second copy nobody was looking at. `legacy`, `backups`,
    `*.dump`, `*.sql.gz`, `.env` and `coverage` are excluded now.
28. **A failing request wrote member records to the log.** `app.onError` logged
    the error object. drizzle carries every bind parameter on it, once in the
    message and again in `params`, and pg puts the offending value in `detail`.
    Reproduced against the real schema: a duplicate email during signup put the
    new member's name, email, phone, postal code and emergency contact in the
    log, twice. On a token-bearing table it is a session token or a reset token.
    The handler now logs the statement, which is parameterised, plus the
    Postgres code, table and constraint, and nothing else. Five tests.
29. **Nothing bounded the container logs.** All four services ran on the default
    json-file driver with no rotation, so the disk fills and takes the members
    database and the door status with it. One anchor, applied to every service.
30. **Caddy logged nothing per request**, because the access log is opt in and
    nothing opted in, while `docs/operations.md` sent the 2am volunteer to it
    first. It also set no security headers and no request size limit. The
    Caddyfile now carries `log`, four headers and a 1 MB body limit, each proved
    against a throwaway Caddy before it went in: headers on both static and
    proxied responses, deep links unaffected, 100 kB accepted and 2 MB refused
    with 413. The two claims `operations.md` made about that log turn out to be
    true for the failure case, measured rather than assumed, and the document
    now says which half is which.
31. **A failed migration took the running site down.** `docker compose up -d`
    recreates the api and web containers and only then runs migrate, confirmed
    with `--dry-run`. `make up` now builds, migrates as its own step, and starts
    the stack, so a bad migration stops the deploy with the site still serving.
32. **Secrets were written 0600 and the containers read them as uid 1000.**
    Compose mounts a file secret as a plain bind mount and ignores `uid`, `gid`
    and `mode`, so on a Linux host where the deployer is not uid 1000 the
    migrate container dies with EACCES and the api never starts. The directory
    is 0700 and the files 0644 now, on both hosts.
33. **`tools/backup.sh` wrote the whole members database world readable**, with
    no `umask` and no `chmod`, two files away from `make secrets` writing 0600.
    It sets `umask 077`, a 0700 directory and 0600 files now.
34. **The restore drill's readiness check raced the Postgres entrypoint.**
    `pg_isready` answers during the image's init phase, before the entrypoint
    shuts the temporary server down and starts the real one. It passed five for
    five on an idle laptop and failed repeatedly under load, which is what a CI
    runner is. It waits for `PostgreSQL init process complete` and then a real
    query now.
35. **The import runbook could not be run on the host it targets.** Steps 5, 6,
    8, 9 and 10 called `node tools/import/main.ts` and `pnpm db:migrate` from
    the host against `localhost:5432`, and `compose.yaml` publishes no port for
    the database and the connection string carried no password. They use the
    containerised `make import` path now, which is the one that works.

    Its undo step was worse than not working: `drop schema public cascade`
    followed by a migrate leaves drizzle's own `drizzle` schema behind, so
    `drizzle-kit migrate` prints `migrations applied successfully` over a
    database with no tables. Reproduced. It is `make reset CONFIRM=yes` now,
    with the manual form dropping both schemas by name.

    Step 3 asked for the controller's card table with a bare `?a`, which the
    firmware answers `Not logged in.` The password has to be chained on.
36. **There is no tool that puts a database back.** `tools/restore.sh` restores
    into a throwaway copy and never touches the live database, which is correct
    and is not a recovery. `docs/runbooks/go-back.md` is new and covers the
    three situations separately: a bad deploy, a bad database, and a cutover
    that has to be undone. The restore renames the current database rather than
    dropping it, so a wrong dump does not cost the last hour, and the commands
    were run against a throwaway Postgres before being written down.
37. **The deploy documentation stopped at `make up`.** It never said how the
    first admin comes to exist, never mentioned the import or its ordering, and
    gave nothing to check afterwards. A volunteer following it exactly ended
    with a stack nobody could administer and no members in it. `operations.md`
    now covers DNS before first start, the four `.env` edits, the secret modes,
    the SMTP replacement, the first admin on both an imported and an empty
    database, and four checks that each fail differently.

Smaller, and each verified: `docs/architecture.md`'s route table was missing six
routes and its data table two of the twelve; `CONTRIBUTING.md` required an
OpenAPI document that `0003` declines to build and claimed coverage is collected
when nothing collects it; three privileged routes had no refusal test, so
deleting `requireAdmin` from all three left every test green, and five tests were
watched catching it; `services/door/src/domain/slots.ts` carried a second
implementation of the lowest free slot rule that only its own test called, which
is section 5's one place rule and door permission at that; `.nvmrc` pinned Node
22 while every image runs 24.20, so CI tested a runtime that never ships. Several
package READMEs described things that were not there, notably `marks.ts`
inlining all 29 marks when it inlines three.

What was checked and came back clean: git history holds nothing member shaped,
5.5 MB with no dump and no secret ever committed; all three images build from the
current tree; `PUBLIC_ORIGIN` with a trailing slash does not break sign in,
which was suspected and disproved; the reset link's `redirectTo` is validated
against the trusted origin list, so an attacker cannot point it at their own
domain; `/api/auth/change-email` and `/api/auth/delete-user` are disabled.

### Auditing the audit

The deployment audit's two completeness critics never ran: both died on a spend
limit, so nobody had asked what the ten dimensions missed, and nobody had looked
at the changes the audit itself produced. That pass ran on 2026-09-04 and found
five more, three of them in work from the day before.

38. **`make seed` on a fresh production host hands out a building key.** The only
    guard was that the database already held members, and a production database
    is empty from `make up` until the import runs. `README.md` ends its install
    block with `make seed`, so a volunteer following the front page rather than
    `docs/operations.md` does exactly this on the real host. It writes nine
    invented members, one of them an admin, all sharing the password `heatsync`,
    which the README prints two lines later. An admin can grant themselves card
    access and drive the doors.

    This is the same shape as `make reset` before finding 24: a comment saying
    "only ever run against a local database" and nothing enforcing it. There is
    a `seedRefusal` now, reading the same https signal as the SMTP guard, with
    four tests, and it was watched refusing through the built image and the real
    `make seed` path rather than only in the suite.
39. **The controller timeout message added yesterday lied.** A board that is off
    refuses the connection in about ten milliseconds, and the message said it
    "did not answer within 15 seconds" and told the volunteer to power cycle it.
    Section 7 of `CONTRIBUTING.md` asks an error to say what happened. It now
    separates the two: a `TimeoutError` means the board took the connection and
    stopped talking, which a power cycle fixes, and anything else means nothing
    was listening, which is a wrong `CONTROLLER_URL` or an unpowered board. The
    shape was read off a real rejection rather than guessed: `AbortSignal.timeout`
    rejects with a `DOMException` named `TimeoutError` and no cause, and the
    first attempt at this check looked one level too deep and classified every
    timeout as unreachable.
40. **The log redaction added yesterday threw away the stack.** Stripping the
    bind parameters also removed every frame, so an unhandled error said what
    failed and not where. The frames are file names and carry no values, so six
    of them are kept and the message they hang off is still redacted.
41. **Two rate limit tests were bcrypt bound and over the default timeout.** They
    spend the whole sign-in budget on purpose, so each runs about thirty bcrypt
    verifications at cost 10, and bcryptjs is pure JavaScript per ADR 0013. One
    verify measured 441 ms on a loaded laptop, which is fifteen seconds of work
    against vitest's five second default. They passed on a fast idle machine and
    failed consistently once the machine was busy. They carry an explicit
    60 second timeout now, with the measurement written beside it.
42. **`tools/voice-check.mjs` crashed with a raw Node stack** when run outside a
    git checkout, because `git ls-files` is how it finds its files. It says what
    is wrong and what to pass instead.
43. **`pnpm check` itself failed two full runs in three.** `apps/members`'s
    `lib/auth.test.ts` imports the better-auth client inside each test, because
    the client captures `globalThis.fetch` when it is built and the suite has to
    stand up its fetch first, per ADR 0012. That import is charged to the test's
    own timeout, and the three app suites start jsdom at once: one run spent 129
    seconds in environment setup. The file passes in three seconds on its own.
    That suite has a 30 second `testTimeout` now, with the reason beside it. It
    was nearly written off as a busy machine, which would have left the gate
    failing at random on a CI runner.

Checked and clean this pass: Node 24.20, which `.nvmrc` now names so CI tests
what the images run, passes lint and typecheck and 226 of the 228 API tests in
that image, the two failures being the container not reaching the test database
rather than anything about the runtime. `make up`'s new ordering was confirmed
with `--dry-run` to touch only `db`, never `api` or `web`, so a failed migration
still leaves the site serving.

One measurement worth keeping: running two test suites against one throwaway
Postgres corrupts both, because the Vitest global setup drops the schema. That
is how the first Node 24 run and one local run were made to fail.

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
- No deploy workflow. Deployment is `git pull` and `make up` by hand, per
  `docs/operations.md`. That is a deliberate choice while one person deploys.
- A stack trace from either service points into a bundled file rather than into
  a source file. `docs/decisions/0013-services-ship-as-a-bundle.md` says why,
  and rebuilding the same commit gives the same line numbers.
- The admin app still reaches one better-auth path by hand.
  `apps/admin/src/App.vue` posts to `/api/auth/sign-out` with `fetch`. ADR 0012
  moved the members app onto better-auth's own client and stopped there, because
  the client costs 28.94 kB in a browser bundle and the admin app is used by a
  handful of people. The path is on the served allow list in `auth.ts`, the call
  is bounded by a timeout, and the path is named in a comment beside it.
- better-auth's own client, which the members app uses for sign in, sign out and
  reset, sets no timeout of its own. The four call sites this repository writes
  are bounded; that one is the library's.
- The `current_skills` and `desired_skills` columns are unbounded `text`, the
  response contract has no maximum and the import copies what Rails held, but
  the request contract caps both at 2,000 characters. So the import can write a
  row the profile form cannot send back unchanged. Nothing breaks: the form
  sends only what changed, and a member over the limit can delete characters and
  save, which was checked in a browser against a planted 2,005 character value.
  The import preflight reports the rows so nobody meets one by surprise.
- **Section 12 says door logs are readable by the member they concern, and no
  route lets a member read theirs.** `GET /api/door/events` is admin only, which
  satisfies the "nobody else" half and not the first one, and there is now a
  refusal test for a member asking. Building the member-facing half is a small
  piece of work nobody has taken.
- The boundaries gate does not enforce the last rule in section 5. An app
  importing `packages/schema/src/tables.ts` directly, by relative path or by
  subpath, passes lint: the dependency direction is checked and "a package
  exports through its index" is not. `boundaries/entry-point` is the rule that
  would, and it is not configured. Nothing in the tree violates it today.
- `door_events.actor_id` is a column with a foreign key that nothing writes and
  nothing reads. Removing it is a migration, and migrations against a table the
  database refuses to update are worth doing deliberately rather than in passing.
- Four runbooks' worth of 2am work is still unwritten: rotating a leaked secret,
  the certificate not renewing, the disk filling, and moving the card at slot
  200. `docs/runbooks/` has the import and going back, and `docs/operations.md`
  covers deploying and what to look at when something is wrong.
- No container has a memory, CPU or PID limit. One runaway process can take the
  host down, and the door status with it. The logs are bounded now; this is not.
- Backups are written to the host they protect, and nothing prunes them or
  copies them anywhere else. `caddy_data`, which holds the TLS certificate and
  the ACME account key, is not backed up at all; losing it means Caddy asks for
  a new certificate, which is an inconvenience rather than data loss.
- `tools/restore-drill.sh` proves `pg_dump` and `pg_restore` round trip on the
  image this stack runs. It does not call `tools/backup.sh` or
  `tools/restore.sh`, so those two have never run in CI, and `docs/operations.md`
  now says so rather than implying otherwise.
- **The status LED may not survive the move to https.** The SpaceAPI template is
  http throughout, including its own `url`, `logo`, `cam` and `feeds`, because it
  is copied from production unchanged. An ESP8266 reading
  `http://<host>/space_api.json` meets Caddy's redirect to https and then needs
  TLS with a CA bundle, which is not a given on that part. Nobody has looked at
  the LED's firmware. This is a cutover risk with a silent failure: the sign goes
  dark and nothing logs anything.
- The guard from finding 24 covers a card table that is empty, not one that is
  partially there. A members database answering with one card row out of
  sixty-four would still clear the other sixty-three. `pg_restore` is
  transactional per table so a half filled `cards` table is unlikely, which is
  why the guard is written on "no rows at all" rather than on a fraction, but
  the limit is real and is worth widening if a partial state ever turns up.
- `AbortSignal.timeout` is Safari 16 and Chrome 103. An older browser throws
  inside the client's try block, so a member on such a device is told the API
  could not be reached when the problem is their browser. The fallback is an
  `AbortController` and a `setTimeout`, about eight lines. It was left alone
  because the failure is a wrong message rather than a broken screen and nobody
  has established that a member uses such a device.
- A `.env` written before 2026-09-04 has no `COMPOSE_PROFILES=dev`, so `make up`
  on an existing development machine stops the mail catcher. Adding that line
  brings it back.
- `/space_api.json` has never been proven byte for byte against the live one.
  `README.md` says parity gets proven on a test hostname before the hostname
  moves, and nothing does that yet. The lab website and an ESP8266 status LED
  both read it, and neither is in this repository.
- The 95 findings of the deployment audit are not all fixed. What is left is
  mostly documentation detail and small duplication in `apps/admin`, and the
  full list with evidence is in the audit transcript rather than in this file.

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
