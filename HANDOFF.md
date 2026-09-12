# Handoff

What exists, what is not done, what nobody has confirmed, and who has to decide.
Adding to this file is not an admission. It is the point.

Last updated 2026-09-12, after the four passes in section 6.

## 1. State

Two processes. 26 source files, about 4,300 lines including the two scripts, and
2,200 lines of tests. Thirteen tables, forty routes, eight runtime
dependencies.

### What has been run

Everything below was executed on 2026-09-11 against Node 24.20 and Postgres 17
in containers, not inferred from the diff.

- `make typecheck`: clean for both services.
- `make voice`: clean.
- The API suite, 78 tests, against a real Postgres with the schema built from
  nothing by `scripts/migrate.ts`.
- The door suite, 36 tests, including the whole codec over a real socket.
- The CI workflow, step for step, from a clean checkout: three `npm ci`
  installs, the schema built from nothing, then typecheck, the copy gate and
  both suites.
- `scripts/nightly.sql`, against planted rows on both sides of every line it
  draws. It deletes the expired session and keeps the live one, deletes the
  three year old door event and keeps the one year old one, and clears the
  expired reset token and keeps the live one.
- `scripts/backup.sh` and `scripts/restore.sh`, as a round trip: a dump taken
  from the running stack and restored into a scratch database that answered
  with the row counts it went in with.
- `scripts/migrate.ts` across three files, applied in order, then run again to
  prove it skips what it has already done.
- The API image built and served `/healthz`, `/.well-known/jwks.json` and
  `/space_api.json`.
- The whole loop end to end: an admin minted a service token, the door service
  authenticated with it, fetched the card list, wrote both seeded cards to a
  simulated board, posted its placements, and reported state and capabilities.
  A queued `open` ran within one tick and came back `done`. A rear unlock was
  refused and the refusal is in the audit log. An unissued card held to the
  simulated reader arrived as a `presented` event with its card id.
- The legacy import, against the fixture in `scripts/legacy-fixture.sql`: slots
  preserved, a Devise hash signed in and was replaced with Argon2id in place,
  the card at slot 200 moved to one the reader can see, and every column the
  audit recovered arrived, including a waiver date for the member who signed
  without a contract row.

### What has not been run

Anything involving the real controller, and the import against the real dump.
Sections 3 and 5 are about those.

## 2. Where this differs from the specification

`hsl-web-api-spec.md` revision 3 is what this implements. Six places differ, and
each one is a deliberate choice rather than an oversight.

**Forty routes, not thirty.** The specification's own tables in section 4 list
thirty six rows, and its summary says thirty. All thirty six are built. Four
more were added: `GET`, `POST` and `DELETE /api/service-tokens`, because section
6.2 requires `service_token.create` and `service_token.revoke` audit actions and
no route in the specification could write them; and `GET /api/audit`, because
the argument for letting one admin act immediately is that the audit log makes
it visible afterwards, and a log with no way to read it does not.

**Six guards, not four.** Section 4.1 names a `session` guard for logout and the
token exchange, and section 2.7's table lists four without it. It is real and it
matters: without it a JWT can buy another JWT, which is a refresh token, and
section 2.4 says there are none. `doorAccess` is the sixth, which section 4.7
also names without listing.

**Eight adapter methods, not seven.** The interface in section 5.3 declares an
`alarm` capability and has no method that arms one. `setAlarm` is optional,
declared through `capabilities()`, and a controller without an alarm omits both.

**`GET /api/door` answers an array.** Section 5.7 runs the old controller and the
new one side by side for a week, with two controller ids, and the single object
in section 4.7 cannot express that.

**`door_state` carries a `capabilities` column.** The API has to refuse
`alarm.arm` against a controller that cannot arm one, and nothing in the
thirteen tables held what a controller said it could do. The column is
controller wide and repeated on each of that controller's rows, which costs one
array per door and saves a fourteenth table.

**The card list version is computed, not stored.** Section 5.5 says an admin
change bumps the version. A digest of the list cannot be forgotten by a route
written next year. `docs/decisions/0009` has the reasoning.

**Six columns the specification's schema does not have.** `oriented_on`
replacing `oriented`, plus `postal_code`, `emergency_email`, `email_visible` and
`phone_visible` on `members`, and `cosigner` on `waivers`. Every one holds data
the legacy database holds and the specification's tables have nowhere to put.
The visibility flags are the ones that forced it: without them the directory
overrides a preference a thousand members already expressed.
`docs/decisions/0013` is the reasoning. Still thirteen tables.

**One trigger became two, on `door_events`.** Section 3.3 attaches the same
append-only trigger to both tables. It cannot be the same one: `audit_log` is
kept forever and `door_events` is kept two years, so the specification's own
retention in section 6.4 is a delete that its own trigger refuses. The window
now lives in the trigger, which is the authority on what may go, and the nightly
job can run.

Two smaller ones: the database password is an environment variable rather than a
compose secret, because a compose secret outside swarm is a bind-mounted file on
the same host and having two sources of truth for one password is how they come
to disagree. And `space_api.json` gains a `lastchange` key and reports a stale
reading as closed, where the legacy document repeated its last reading forever.

## 3. Unknowns that need somebody at the lab

Nobody has been in front of the controller. Each of these is about five minutes
with VLAN access, and each one changes something.

1. **Dump the card table with `?a`.** Three things at once: whether the deployed
   board prints tags or asterisks, whether the card at slot 200 is really on the
   device, and whether the board answers the way this repository believes at
   all. The repository it runs has not been pushed since 2013 and nothing here
   records a version read off the device.
2. **Whether the deployed firmware is the DEBUG build.** Check this before
   anything else. `dumpUser` prints the tag only when `DEBUG` is 2, firmware
   line 105, and prints asterisks otherwise. The adapter detects this and falls
   back to trusting its placements, which works, but on such a board a card
   written outside this system is never noticed. Knowing costs one `curl`.
3. **Which physical door is controller door 1.** `DOOR_ORDER` says which name
   maps to which, and it defaults to `front,rear`. Getting it wrong opens the
   wrong door.
4. **The live `PRIVPASSWORD`, controller IP and MAC.** The committed `0x1234` is
   the public example. The value to configure is the four characters `1234`, and
   the door service refuses to start on anything else.
5. **Whether the ESP8266 status LED can speak https.** The SpaceAPI template is
   `http` throughout, including its own `url`, `logo`, `cam` and `feeds`, because
   it is production's copy unchanged. A part reading `http://host/space_api.json`
   meets a redirect and then needs TLS with a CA bundle. Nobody has looked at
   that firmware. This is a cutover risk with a silent failure: the sign goes
   dark and nothing logs anything.

## 4. Decisions somebody has to make

These block deployment, not development. None is technical.

1. **Whether the board sanctions this rewrite.** A recorded position from
   2026-05-17 says the lab already decided against another bespoke one-off
   platform. Nobody has confirmed a position either way. Building a system the
   board does not want is worse than building nothing.
2. **Which machine is the public host.** The machine currently called `hsl-web`
   is 32 bit CentOS 6.8 on kernel 2.6.32 and cannot run Docker at all. Nothing
   here deploys to it. This is the single biggest risk to the project and it is
   not a software problem.
3. **Sign-off on one admin acting immediately**, with the audit log instead of
   two-admin approval. `docs/decisions/0008` states the trade in the words the
   board should hear it in. If they want approvals it is one table, one route
   and a refusal test, and it is far cheaper to know now.
4. **An SMTP account.** Password reset does not work without one, and the API
   refuses to start on https without one.
5. **Waiver retention and the under-18 path.** No legal input yet, and undoing a
   signup depends on the answer.
6. **Whether `open` on the rear door is covered by the 2018 decision.** Unlocking
   it is refused here. Opening it pulses the strike for five seconds with
   somebody standing there, so it is deliberately allowed. If the board reads
   that decision the other way it is one entry in `REFUSED` in
   `api/src/routes/door.ts`.

## 5. Known gaps in what is built

- **The import has never run against the real dump.** It has a preflight that
  refuses on the four failures section 7.3 names, and it reports rather than
  guesses. It has not been run. `docs/runbooks/import-the-members-database.md`
  is the sequence, and step 6 is the only verification that counts.
- **The import assumes the legacy timestamps are UTC.** The assumption is
  written at the top of `scripts/import.ts` with what would confirm it and what
  it costs if it is wrong, which is every waiver, orientation and payment date
  landing seven hours away.
- **A lapsed or suspended member can sign in and is then refused everywhere.**
  That is what the specification's guard table says, and the message says why.
  Whether a lapsed member should be able to read their own profile and pay their
  dues is a question for the lab, and it is one line in `asMember`.
- **No screen exists for anything.** `docs/decisions/0012` says why the front end
  is not here. Until one exists, enrolling a card that arrived as `presented` and
  undoing a signup are `curl` commands.
- **An admin cannot undo a signup.** `DELETE /api/members/:id` refuses an account
  with any history, and signup writes a waiver, so it refuses every account
  signup creates. Untying that starts with the board question about waiver
  retention.
- **`members:read` and `status:read` are scopes no route consumes.** They exist
  because section 2.5 names them for a kiosk and for locking down public status.
  Minting a token with either does nothing today.
- **Three legacy columns are still not carried.** `users.payment_method` and
  `users.payee` describe how a member pays, and this system has no workflow for
  either, so `payments.method` records what actually happened instead.
  `users.oriented_by_id` is who oriented somebody, which `oriented_on` does not
  keep. All three are readable in the archive for a year. If any of them matters
  they are one migration and four lines of the import.
- **The session cookie is scoped to the apex domain on purpose**, which means
  any HeatSync subdomain can act as the member who is signed in. That is the
  price of one login across every app with no protocol, and it is worth saying
  out loud before the next subdomain goes up.
- **A command claimed and not resolved is claimed again on the next tick.** The
  door service resolves everything it claims, and a pass cannot overlap the one
  before it, so this shows up only if the service dies mid-command. Then the
  command runs twice, or expires after two minutes, depending on timing.
- **The first tick after a restart can label a refused read as `presented`.**
  The adapter learns which cards are issued from `uploadCards`, and the drain
  runs before it on that one tick. The window is five seconds from process
  start, and the event still carries the right card id, so the member it belongs
  to is still found.
- **`POST /api/forgot` not waiting for the mail server has no test.** An SMTP
  failure is not reachable from the suite, which has no SMTP server to fail.
  `mail_failed` in the log is how it is seen instead.
- **Nothing prunes `hits`, the rate limit counter, on a schedule.** It is swept
  when it passes five thousand keys and capped at twenty thousand, which is
  bounded and not tidy.
- **`HeldCard.claimed` is a field nothing reads.** It is in the interface the
  specification defines and no adapter or caller uses it.
- **The door service does not handle SIGTERM.** A stop part way through a tick
  loses whatever events were held in memory at that moment. The next pass reads
  the board again, so the loss is bounded by what had already been cleared off
  it.
- **`?q=` on the directory passes `%` and `_` through to `ilike`**, so a search
  for `a_b` also matches `axb`.
- **A failed sign in logs the address that was tried.** That is the useful
  security log and it is also a list of addresses in the container log.
- **An admin can flip another member's visibility preferences**, because
  `ADMIN_FIELDS` is the member's own list plus the privileged ones. It is a
  preference that belongs to the member and nothing stops an admin setting it.
- **`scripts/restore.sh` leaves the scratch database behind on purpose**, so a
  staging API can be pointed at it, and nothing removes it afterwards.
- **A door event older than two years cannot be removed one row at a time by
  anything except a delete that names the window.** That is the point, and it
  also means a mistake in the retention is a loud error rather than a quiet
  over-delete.
- **The mass clear guard is a fixed number, five.** It covers a card list that
  came back short. A lab with more than five cards revoked in one sitting will
  meet it, and the fault event says exactly what was withheld and why.
- **Nothing prunes `service_tokens`.** A revoked row stays forever, which is
  correct for the audit trail and means the table only grows.
- **`TRUNCATE` is not blocked on the append-only tables.** The trigger covers
  update and delete. Truncating needs table ownership, and the test harness uses
  it. A statement-level trigger would close it at the cost of the suites
  needing another way to reset.
- **No deploy workflow.** Deployment is `git pull` and `make up` by hand, per
  `docs/operations.md`. That is a deliberate choice while one person deploys.
- **Backups are not proven.** `scripts/backup.sh` and `scripts/restore.sh` have
  been read and not run against a real deployment. Gate 1 in section 13 of
  `CONTRIBUTING.md` is not met until somebody runs the restore.
- **`/space_api.json` has never been compared byte for byte against the live
  one.** There is a test that every key of the template survives and that the
  two status strings match the legacy derivation. Comparing against the running
  system on a test hostname is still to do, and it is the step before DNS moves.

## 6. The audits, and what they taught

Four adversarial passes over the whole branch, on 2026-09-11 and 2026-09-12,
after it was first written. Thirty nine defects, each proved with a probe or a
failing test before it was fixed, and each fix covered by a test where a test
can reach it.

The four commits after the first carry the blow by blow. What is worth reading
here is what kept coming back, because the next pass should start by looking for
more of the same.

### What each pass looked for

| Pass | Read for | Found |
| --- | --- | --- |
| 1 | Correctness against the specification | 11 |
| 2 | Failure, load, and clocks | 9 |
| 3 | Line by line, every file, nothing assumed | 16 |
| 4 | Running the things that had only been written | 3 |

### The patterns

**A wrong request answering as a broken system.** Three separate shapes of it. A
path segment that is not a uuid reached a uuid column and Postgres refused it
with an error, so a mistyped URL answered 503. A duplicate on a unique index did
the same. A stored hash that would not decode did the same, because Argon2
throws where bcrypt returns false. 503 is the status this API keeps for meaning
the database is down, and spending it on a typo both misleads the caller and
buries the signal. Every one of these is now a 404 or a 409.

**A value that is not a number failing open rather than closed.** Twice.
`Number('soon')` is NaN and every comparison against NaN is false, so a stale
threshold nobody typed correctly meant the door never reported a stale reading.
`setInterval(fn, NaN)` runs every millisecond, so a tick interval nobody typed
correctly turned the poll loop into a flood. Both stop the process now, and
every setting that should be a whole number goes through one check.

**A guard that only matched the shape it was written for.** The 2018 refusal
matched `unlock` on the rear door and not an unlock with no door named, which
reaches the controller as "unlock everything". The member delete refusal looked
at rows about a member and not rows naming them, so a former admin met a foreign
key instead of a sentence. The adapter fell through to door one for a name it
did not know. Each was a rule that was right about the case somebody had in mind
and silent about the neighbouring one.

**Something written and never run.** The fourth pass is entirely this. The two
year retention on `door_events` could not run at all, because the append-only
trigger refused the delete: the table would have grown forever and three
readings of the code had not noticed. `scripts/backup.sh` joined `$PWD` to a
`BACKUP_DIR` that was already absolute and wrote the archive into the
repository. Both were found by typing the command, not by reading. The CI
workflow, the nightly job and the restore were in the same state and turned out
to be sound. Running them is cheap and reading them is not enough.

**A poison message retried forever.** One event the API could not write failed
the whole batch, and the door service holds a refused batch and offers it again
every five seconds. Every card read after it would have been stuck behind one
bad row.

**Data the specification's schema had nowhere to put.** Six columns, including
the waiver date for the roughly seven hundred members who signed without a
contract row. The trim in the specification is deliberate and mostly right, and
it is worth checking every dropped column against the legacy table rather than
trusting that.

### What was proved not to be a defect

Each of these was about to be changed on a wrong belief. They are recorded so
nobody spends the time again.

- **Caddy replaces a client's `X-Forwarded-For` rather than appending to it**,
  measured with a real Caddy in front of a real backend. Taking the first entry
  is the true client address behind this Caddyfile, so the per-IP rate limit
  cannot be stepped over by sending the header. True only while no proxy is
  trusted, which is the configuration here.
- **bcryptjs answers false for a malformed hash** rather than throwing. Only the
  Argon2 branch needed a guard.
- **`sql.begin` hands back a transaction's rows in order**, without unwrapping
  them, which is what `change()` relies on.
- **Node's test runner reads `.ts` directly** on 24.20, and `make typecheck`
  catches what the suite cannot: type stripping does not type check, and a
  green suite on this stack is not a typecheck.

### What has not been audited

The honest list, and the best place for a fifth pass to start.

- **Nothing has ever spoken to the real controller.** Section 3.
- **The import has never run against the real dump**, only against the invented
  fixture in `scripts/legacy-fixture.sql`.
- **Two controllers have never run side by side.** Section 5.7 of the
  specification is the case the whole placement design exists to pass, and it
  has never been exercised, even though two simulators and two controller ids
  would do it on a laptop.
- **Nothing has run for longer than a few minutes.** No soak, no evidence about
  leaks, connection churn or table bloat over time.
- **No load or concurrency work** beyond one test of two requests racing on a
  unique index.
- **Timing side channels were reasoned about on the sign in path and never
  measured**, on any path.
- **`/space_api.json` has never been compared byte for byte with production.**
- **The Caddyfile headers have not been checked against a current baseline**,
  and the base images are pinned by tag rather than by digest, and unscanned.
- **No screen exists**, so nothing has exercised the cookie across subdomains,
  a reset link in a real mail client, or any of the flows end to end as a
  person.

## 7. Open licence questions

- **`Open_Access_Control_Ethernet` has no licence file at all.** The lab owns the
  repository and should put one on it. Until then, this project reads it as
  documentation, which is what `door/src/adapters/openaccess.ts` does: no code
  is copied, the protocol facts are.
- **`Open-Source-Access-Control-Web-Interface` has no licence file either**, and
  the schema and the SpaceAPI template come from it. Same answer, same fix.

Both are HeatSync's own work, so this is a piece of housekeeping rather than a
risk, and it is five minutes for somebody with commit access.

## 8. If you are picking this up

Read in this order: `README.md`, then `api/src/index.ts`, which is the route
table and nothing else, then `migrations/001_init.sql`. That is the whole system
in three files.

Then `CONTRIBUTING.md` before changing anything, and `docs/decisions/` when
something looks like it was done the hard way.

To get it running:

```sh
make install && make secrets   # then put a password in PG_PASS and DATABASE_URL
make up && make migrate && make seed
make check
```

Node 24 or newer, because the TypeScript runs without a build step and older
versions will not load it. The suites need the Postgres that `make up` starts.
`make typecheck` is not optional: stripping types is not checking them, so a
green suite on this stack says nothing about the types.

Four passes have been over this code and section 6 says what they covered. The
bar for a new finding is not that it looks wrong, it is that you ran it and it
was. Three things in section 6 were about to be changed on a wrong belief and
only a probe caught it.

The two things that must not break are in section 13 of `CONTRIBUTING.md`. A
verified restorable backup, and the door keeping working when everything here is
down. Every other rule in this repository is negotiable and those two are not.
