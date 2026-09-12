# Handoff

What exists, what is not done, what nobody has confirmed, and who has to decide.
Adding to this file is not an admission. It is the point.

Last updated 2026-09-12, after the seven passes in section 6.

## 1. State

Two processes. 26 source files, about 4,400 lines including the two scripts, and
2,200 lines of tests. Thirteen tables, forty routes, eight runtime
dependencies.

### What has been run

Everything below was executed against Node 24.20 and Postgres 17 in containers,
not inferred from the diff. The first group is from 2026-09-11, the group under
the fifth pass from 2026-09-12.

- `make typecheck`: clean for both services.
- `make voice`: clean.
- The API suite, 89 tests, against a real Postgres with the schema built from
  nothing by `scripts/migrate.ts`.
- The door suite, 39 tests, including the whole codec over a real socket.
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

The fifth pass ran these for the first time.

- **Two controllers side by side**, which is section 5.7 and had never been
  exercised. Two simulated boards and two door services, `alpha` and `beta`,
  against one API for the length of the pass. Each held its own placements for
  the same two cards, each took only its own commands, an unissued card at one
  reader and an issued card at the other arrived as `presented` and `denied` on
  the right controller, and revoking a card cleared it off both boards. Two
  defects came out of it and are in section 6.
- **An hour of both door services running**, sampled every minute, with a card
  at each reader every twenty seconds and a command every minute. The table is
  in section 6. One defect came out of it.
- **The sign in timing side channel, measured** rather than reasoned about, and
  two others beside it. Section 6.
- **The Caddyfile, with a real Caddy in front of the API**, to read the headers
  it actually sets rather than the ones it is asked for.
- **Every base image pinned by digest**, and the pinned references built and ran:
  the API image from the pinned `node`, and `docker create` on the pinned
  `postgres` and `caddy`, which is the form CI and compose both use.

The sixth pass ran these for the first time.

- **The directory at the size the lab actually is.** A thousand members, every
  free text field full, read as a member reads it. Numbers in section 6.
- **The loop in front of a slow board**, which is what the real one is. A first
  pass writing two hundred cards, timed at 50 ms and at 200 ms a request.
- **The health endpoint, from where the runbook says to read it.** That is how
  the fourth defect below was found: it cannot be read from there.
- **The import against a fixture carrying the rows nobody had planted**, a
  payment with no date and a grant naming a certification that is not there,
  then applied and counted against what the report promised.

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

Nobody has been in front of the controller. Most of these are about five minutes
with VLAN access, and each one changes something. The last three want the
firmware source or the lab website rather than the board itself.

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
5. **Whether the event log holds signed or unsigned 16 bit values.** `addToLog`
   splits a 32 bit card id across two entries, so the high half has to fit in
   sixteen bits. Signed puts the ceiling at `0x3FFF7FFF` and a card past it is
   dropped from the log; unsigned puts it at `0x7FFFFFFF` and a card between the
   two comes back as a different, entirely plausible card id. `LOG_TAG_CEILING`
   in `door/src/adapters/openaccess.ts` assumes signed, which is the lower of
   the two, and raises a fault for anything past it. Nothing the lab holds
   reaches either ceiling: the longest card id in the dump is seven hex
   characters. It matters the first time somebody buys a batch of eight
   character fobs. Reading the declaration behind `logData` settles it.
6. **Whether anything reads `/space_api.json` from another origin.** Measured
   with a real Caddy: no CORS header is set on it, so a browser page on another
   origin cannot read it with JavaScript. The ESP8266 is not a browser and does
   not care. The lab website does, if it is served from somewhere else and
   fetches this rather than having it rendered in. Same family as the question
   below and the same silent failure.
7. **Whether the ESP8266 status LED can speak https.** The SpaceAPI template is
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
- **Claiming is not exclusive, so two door services on one controller id both
  get every command.** Measured: four simultaneous claims all came back holding
  the same command. `claimed_at` is written and nothing reads it. The one that
  posts its result first gets a 204 and the others get a 404, which `runCommand`
  meets as a link failure, so the losers log `door_link_down` and fail their
  health check until the next tick. Left as it is on purpose: filtering on
  `claimed_at` is what would make it exclusive, and that is the same filter that
  lets a service which died mid-command pick the command back up. The case is a
  deploy where the old container outlives the new one, or two lab hosts pointed
  at one controller id, and the commands themselves are all safe to run twice.
- **An optional text field that cannot be stored is dropped rather than
  refused.** A label or a note carrying U+0000 now makes `text` answer null, and
  a route that treats the field as optional writes null and answers 201. That is
  the same thing an over-long label has always done, so it is consistent rather
  than new, and it is worth knowing that the value went missing quietly. The
  required fields refuse with a 400.
- **The directory is a 4.1 MB answer at a thousand members** with every free text
  field full, and twenty concurrent reads cost about 90 MB of the API
  container's 512 MB. Section 6 has the measurements. Nothing is wrong; it means
  this route is not one to poll, and there is no front end yet to poll it.
- **The base images are pinned and still unscanned.** `docker scout cves` against
  the pinned digest is the command, and it wants a Docker Hub login this session
  did not have. Now that the digests are pinned, a scan is at least reproducible
  and says something about a known artifact.
- **Nothing retires a controller.** `door_state` rows are written by the
  controller and removed only when that same controller stops naming a door, so
  a board that is unplugged sits there forever with a frozen `reported_at`.
  After the week in section 5.7 the retired one still counts as reporting, so
  every command has to name a controller from then on. Retiring one is
  `delete from door_state where controller_id = '...'` in psql, and there is no
  route for it because it is a rare deliberate act rather than a thing an admin
  does.
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

Seven adversarial passes over the whole branch, on 2026-09-11 and 2026-09-12,
after it was first written. Fifty defects, each proved with a probe or a
failing test before it was fixed, and each fix covered by a test where a test
can reach it.

The commits after the first carry the blow by blow. What is worth reading here
is what kept coming back, because the next pass should start by looking for more
of the same.

### What each pass looked for

| Pass | Read for | Found |
| --- | --- | --- |
| 1 | Correctness against the specification | 11 |
| 2 | Failure, load, and clocks | 9 |
| 3 | Line by line, every file, nothing assumed | 16 |
| 4 | Running the things that had only been written | 3 |
| 5 | Two controllers, a soak, concurrency, and measuring | 4 |
| 6 | Load at lab size, a slow board, and the import script | 5 |
| 7 | Walking all seven runbooks, command by command | 2 |

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

**A comment naming a mechanism that cannot fire, and a test named after it.**
The fifth pass found one and it had survived four readings. `door_placements`
cascades on a delete of the credential, and revoking a card is an update, so
nothing removed the placement. The test that would have caught it is called
"revoking a card takes its placement with it" and does not revoke a card: it
deletes the row in SQL, which no route does. Four passes read the name, agreed
with it, and moved on. A test whose name claims more than its body does is worse
than no test, because it spends the attention that would have found the gap.

**A wrong request answering as a broken system, in the case nobody had set up.**
The same pattern as pass one, three shapes on, and it took running two
controllers to reach it. With two reporting, a command that does not name one
answered 503, and so did a command naming a controller that does not exist, with
the text "No controller has reported to this API" while two were reporting.

**And two more shapes of it in the sixth pass, which is seven in all.** A
`?before=` cursor past `Number.MAX_SAFE_INTEGER` stopped being the number that
was typed: the largest bigint arrives as 9223372036854776000, Postgres refuses
it, and paging too far on any of the three paginated routes read as the database
being down. The bigint maximum itself failed, so the shape was not exotic. And a
body carrying U+0000 in any text field answered 503 on every route that stores
one, because a Postgres text column cannot hold that byte and postgres.js hands
it straight through. Seven shapes of one pattern over six passes is the argument
for reading the whole class rather than the instance: the question is not "is
this input rejected" but "does every value the caller controls reach the database
as something the database can take".

**Two writes that had to be one.** Rule Four of the README is that a privileged
change and its audit row go in the same transaction, not beside it, and `change`
makes that impossible to forget for `audit_log`. `door_events` was left outside
it. `POST /door/commands/:id/result` updated the command and then inserted the
event as two statements, so a detail the database refused left the command
resolved with nothing recording it, and answered 503 saying "Nothing was
changed" when the command row had been. The expiry path in the same file had the
same shape. Both are one transaction now. The rule was right and the reach of the
thing that enforces it was too short.

**A runbook step that cannot be run.** Three of them now, and the seventh pass
went looking on purpose after the sixth found the first by accident.
`docs/runbooks/the-door-service-will-not-
talk-to-the-controller.md` opens with `curl -s localhost:9000`, and that cannot
work on the lab host: the health server binds to localhost inside the container
and `compose.lab.yml` publishes no port, because this service accepts nothing
inbound. The line above it correctly reaches into the container for the logs.
Running it turned up a second layer as well, that `localhost` inside the image
resolves to IPv6 first while the health server is on IPv4, so even the corrected
command needed the address rather than the name. Step one of the 2am runbook,
for the failure the runbook is named after.

The seventh pass walked all seven runbooks command by command against a running
system. Two more came out of it.

`docs/runbooks/import-the-members-database.md` ends with the SQL that makes the
first admin on a fresh install with no legacy database, and it sets
`oriented = true`. There is no such column: it is `oriented_on`, a date, which is
section 2 of this file and has been since the schema was written. So the answer
to "there is no admin and nothing can be done without one" was a statement that
answers `column "oriented" of relation "members" does not exist`.

`scripts/backup.sh` left a nought byte dump behind when the database was down.
The shell creates the file the moment it opens the redirect, before `pg_dump`
runs, so a night when Postgres was not up left an `hsl-<stamp>.dump` of zero
bytes sitting in the backup directory looking exactly like a backup, and the
newest file is what somebody restoring reaches for. `pg_restore -l` on it says
"input file is too short". That is gate one of section 13 of `CONTRIBUTING.md`,
which is one of the two rules in this repository that are not negotiable. The
dump is now written under a name a restore will not match and moved into place
only once `pg_dump` has succeeded.

The other five runbooks did what they said. That is in the list below, because a
runbook that was checked is worth as much as one that was fixed.

**A report that counted intentions rather than rows.** `scripts/import.ts` has
always skipped a row it could not place, and the report counted the legacy table.
Against a fixture with a payment carrying no date and a grant naming a
certification that is not there, it printed `payments: 5` and wrote three, and
said nothing at all about two of the four rows it dropped. Money and tool access,
in the script that runs once, against the database nobody has seen, whose whole
job is to report rather than guess. The counts are what will be written now,
every dropped row is named with its reason, and both come from the same
predicates the write walks.

**Something that only grows.** Two of them, and only a soak reaches either. The
simulator remembered every query it had ever answered, measured at about 105
bytes a request and 11 MB per hundred thousand, which is nine days at the tick
rate and well inside the week section 5.7 asks two simulators to run. It is
bounded at a thousand now, which is far more than the tests that read it need.
The other is `door_placements`, above. Both are the shape the code already knows
to avoid: `HELD_EVENT_LIMIT` and `MAX_KEYS` exist because a process that grows
without limit takes the lab host down, and these two were simply missed.

### What the fifth pass measured

Numbers rather than reasoning, because section 6 of the previous pass said these
had only ever been argued about.

**Sign in does not answer faster for an address nobody holds.** 250 wrong
passwords against 250 real accounts, and 250 against addresses nobody holds,
each with a distinct forwarded address so neither rate limit fired and every
answer was the 401 from the verify path. Medians 18.9 ms and 20.5 ms, the
unknown address the slower of the two, and the distributions overlap almost
entirely. The dummy Argon2 verify in `verifyPassword` does what it claims.

The first attempt at this measurement was wrong and said the gap was 21 ms. It
held the address constant, so the per-address rate limit answered 429 without
hashing anything and it was timing the refusal. Worth saying because the wrong
number was the alarming one.

**`POST /api/forgot` leaks about 1.5 ms** for an address that exists, which is
the extra token write. The distributions overlap, and the per-IP limit caps
anybody at ten addresses per quarter of an hour, so it is a signal that cannot
be collected often enough to be a membership oracle.

**A service token id that exists answers 26 ms slower** than one that does not,
because a miss never reaches the Argon2 verify. The comment in `auth.ts` already
says the id is a guessable name rather than a secret, and the measurement agrees
with it. Not a defect, now measured.

**An hour of two door services against one API, sampled every minute.** A card
at each reader every twenty seconds and a command every minute, which is a
busier building than the lab is. What a leak would show up in is the floor of
resident memory per window, because that approximates the live set after a
collection where an average only shows the sawtooth.

| Window | door alpha | door beta | api | simulator |
| --- | --- | --- | --- | --- |
| 0 to 9 min | 91.4 MB | 94.6 MB | 100.4 MB | 92.0 MB |
| 10 to 19 | 94.7 | 98.0 | 105.0 | 94.2 |
| 20 to 29 | 99.3 | 102.6 | 107.6 | 89.6 |
| 30 to 39 | 96.4 | 100.0 | 108.7 | 89.8 |
| 40 to 49 | 96.4 | 100.1 | 108.7 | 90.6 |
| 50 to 59 | 96.4 | 100.0 | 109.5 | 90.7 |

Both door services and the simulator warm up over the first half hour and then
stop dead: the last three windows are the same number. The API's floor is still
moving by under a megabyte across the last twenty minutes, which is not
separable from heap sizing at a one minute sample and is the one reading here
that would want a longer soak to call flat with confidence. It is nowhere near
the 512 MB the container is limited to.

Postgres connections were two or three for the whole hour, so nothing churns
them. `door_placements` did not move. `door_events` grew at exactly the rate
cards were presented and commands were run, 7.0 a minute against 7 events a
minute of load, so nothing writes a row per poll. That last one is the property
the schema was shaped around: the legacy system wrote a status snapshot on every
poll and reached 2.8 million of them.

### What the sixth pass measured

**The directory at the size the lab actually is.** A thousand members, every one
carrying a full 2,000 characters of current skills and desired skills, which is
the worst case rather than the usual one. One read is 4.1 MB and takes 0.15
seconds. Twenty at once cost the API container about 90 MB on top of its resting
125 MB, against the 512 MB it is limited to, and they serialise: the first
answers in 0.49 seconds and the twentieth in 2.67. Three more waves of twenty
settled at 218 MB and did not climb further.

That is the price of the choice in `directory`, which answers with everybody
rather than a page, because a cap below the size of the membership hides people
from each other without saying so. The choice stands and the number is now
written down. What it rules out is polling this route from a screen.

**`?q=` cannot be made expensive.** The pattern goes into an `ilike` with `%` and
`_` unescaped, which is a known gap below, so the obvious next question is
whether a pattern can be made to cost something. It cannot: `name` and `email`
are short, so the worst pattern measured 115 ms through the API and a sixty
repeat `_%` pattern straight at Postgres took 4 ms. It is a correctness wart,
not a way to take the API down.

**A slow board blocks the loop for as long as it takes.** A first pass writing
two hundred cards is 203 requests and nothing bounds a pass as a whole, only each
request at 15 seconds. At 50 ms a request that pass is 10.4 seconds; at 200 ms it
is 41 seconds, during which the five second tick is skipped eight times and no
command is claimed. A command expires after 120 seconds, so the arithmetic that
matters is 120 divided by the number of cards: at 200 cards a pass slower than
about 590 ms a request expires commands before it claims them. The lab holds 64
cards, so the real figure is about 1.8 seconds a request, and the board would
have to be far slower than anybody has seen. Worth keeping in mind when the card
table grows.

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
- **A suspended member's card keeps its placement, and that is load bearing.**
  Run against two controllers: suspending a member clears their card off both
  boards, the placement rows survive, and putting the member back writes the
  card to the same EEPROM slot it had. The slot is an address, keeping it stable
  is the point, and a sweep that removed placements for every card not currently
  on a board would take that away. `GET /api/credentials` reports such a card as
  placed while it is off the boards, which is the price and is worth knowing
  before somebody tidies it.
- **`/space_api.json` is right with two controllers reporting.** It takes the
  newest reading per door across all of them, so a controller that has died does
  not hold the sign open on a stale unlocked reading, and a live one is not
  outvoted by a dead one.
- **Commands are routed per controller correctly.** Two controllers, two
  simulated boards: each ran only what was queued for it, and a stale controller
  refusing a command does not stop the other one taking one.
- **Five of the seven runbooks do what they say**, walked command by command
  against a running system on 2026-09-12. `run-the-door-service.md` end to end:
  the token minted, the service started, `GET /api/door` answered `stale: false`
  with four capabilities, an `open` came back `done` inside one tick, and a card
  held to the simulated reader arrived as `presented | 0000FFFF`.
  `the-certificate-did-not-renew.md` with a real Caddy in front of the API: all
  four of its commands answer, including `docker compose logs caddy` and
  `exec caddy` without the `--profile public` flag, which was the thing worth
  checking because that service is behind a profile. Port 80 answers the 308 it
  says to expect, and the four security headers arrive. `go-back.md` step one
  answers. `scripts/restore.sh` exits 1 on a dump that is not one and 0 on a dump
  that is, so the half of gate one that reads a backup was already right.
- **Rotating the signing key works, the whole way.** `make keys` was run, its two
  values went into a `.env`, an API was started on them, and the JWKS it
  published, a token exchanged against it and that token reaching `/api/me` with
  a 200 all lined up. Worth knowing how: `make keys` prints a PEM with real
  newlines, not the escaped form, so the value in `.env` spans lines. Docker
  Compose reads that correctly because it follows the dotenv rules for a quoted
  value. `docker run --env-file` does not and refuses the file outright, so
  reaching for that instead is the trap. `pem()` in `api/src/tokens.ts` handles
  the escaped form as well, which is why both survive.
- **The import does not need to tolerate a null email or a null timestamp.**
  This was about to be changed. `LegacyUser` types `email`, `createdAt` and
  `updatedAt` as non-null where nearly every other field is nullable, and
  `user.email.trim()` would throw on a null before the preflight printed
  anything. But `db/schema.rb` declares those columns `null: false`, which is
  what `scripts/legacy-fixture.sql` mirrors, and the rule in `CONTRIBUTING.md`
  is narrower than it first reads: it says the legacy database has no foreign
  keys, so any `*_id` may dangle. The import handles every one of those. Do not
  add null guards to columns the legacy schema constrains.

### What has not been audited

The honest list, and the best place for a sixth pass to start.

- **Nothing has ever spoken to the real controller.** Section 3.
- **The import has never run against the real dump**, only against the invented
  fixture in `scripts/legacy-fixture.sql`. This is now the largest thing on the
  branch that has only ever met invented data.
- **`/space_api.json` has never been compared byte for byte with production.**
- **No screen exists**, so nothing has exercised the cookie across subdomains,
  a reset link in a real mail client, or any of the flows end to end as a
  person.
- **The images are still unscanned.** The sixth pass tried and `docker scout`
  wanted a login. Pinning says the image will not move; it says nothing about
  what is in it.
- **Nothing signs in at a thousand members.** The sixth pass measured the
  directory at that size and the concurrency of reading it. Nobody has measured
  the write side, or what a hundred people signing in at once costs when every
  one of them is an Argon2 verify at 19 MiB.
- **`scripts/backup.sh` and `scripts/restore.sh` have been run as a round trip
  and never against anything the size of the real database.** The dump that
  matters is 2.8 million door log rows in the legacy system.
- **The other script.** The sixth pass read `scripts/import.ts` adversarially and
  found the report was counting intentions. `scripts/migrate.ts` has been run and
  not read the same way, and it is the one that decides what a deploy does to the
  schema.
- **The runbooks have now been walked and the docs have not.** All seven runbooks
  were run command by command and two were broken. `docs/operations.md`,
  `docs/architecture.md` and the thirteen ADRs carry claims of the same kind and
  nobody has checked them the same way. `docs/legacy-system.md` is the one that
  matters most and the one that cannot be checked without the dump.
- **`make secrets` and `make hooks` have never been run here.** `make keys` has,
  and it works: see below.

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

Six passes have been over this code and section 6 says what they covered. The
bar for a new finding is not that it looks wrong, it is that you ran it and it
was. Eight things in section 6 were about to be changed on a wrong belief and
only a probe caught it. One of the fifth pass's own measurements was wrong the
first time and the wrong number was the frightening one, which is the argument
for running it twice.

The sixth pass found four of its five by typing a value nobody had typed and one
by running a runbook. There is no cleverness in any of it.

The two things that must not break are in section 13 of `CONTRIBUTING.md`. A
verified restorable backup, and the door keeping working when everything here is
down. Every other rule in this repository is negotiable and those two are not.
