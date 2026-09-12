# Handoff

What exists, what is not done, what nobody has confirmed, and who has to decide.
Adding to this file is not an admission. It is the point.

Last updated 2026-09-11, after the audit in section 6.

## 1. State

Two processes. 26 source files, about 4,300 lines including the two scripts, and
2,100 lines of tests. Thirteen tables, forty routes, eight runtime
dependencies.

### What has been run

Everything below was executed on 2026-09-11 against Node 24.20 and Postgres 17
in containers, not inferred from the diff.

- `make typecheck`: clean for both services.
- `make voice`: clean.
- The API suite, 77 tests, against a real Postgres with the schema built from
  nothing by `scripts/migrate.ts`.
- The door suite, 36 tests, including the whole codec over a real socket.
- The CI workflow, step for step, from a clean checkout: three `npm ci`
  installs, the schema built from nothing, then typecheck, the copy gate and
  both suites.
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

## 6. The audits, and what they changed

Three adversarial reads of the whole branch on 2026-09-11, after it was first
written. Thirty six defects between them, each proved with a probe or a failing
test before it was fixed. The tests are still there.

### The first pass, eleven

**The rear door refusal could be stepped over.** `POST /api/door/command` with
`{"action":"unlock"}` and no door named reached the controller as "unlock
everything", which includes the rear door, and the refusal only matched on the
door name. It is now an audited 409 that says so.

**One bad card id froze the card table for everybody.** The API stores a card id
as text with no format rule, on purpose. The adapter turned one that is not hex
into a thrown exception out of `uploadCards`, which took the whole pass with it
on every tick, forever. It is now a fault against that one card.

**Card reads were lost whenever the API was unreachable.** The controller's log
is a ring that has to be read and then emptied, so events were already off the
board by the time the post failed. They are held in memory now and go up on the
next tick that works. Enrolment is the thing that depends on them.

**There was no way to read the audit log.** The whole argument for one admin
acting immediately is that the log makes it visible afterwards. `GET /api/audit`
existed in the previous attempt and was not carried across.

**Revoking something that was not there wrote an audit row anyway.** Three
routes did it. The log now records what happened rather than what was asked.

**Deleting a member who had ever acted answered 503.** The refusal only looked
at rows about that member, not rows naming them, so a former admin met a foreign
key instead of a sentence. It answers 409 and says to suspend instead.

**The directory showed every address to every oriented member.** The legacy
system carried `email_visible` and `phone_visible` and members set them. The
specification's table has neither, so the rewrite would have overridden a
preference a thousand people had already expressed. See `docs/decisions/0013`.

**The directory stopped at 500 members.** The lab has 1,061. It silently hid the
rest.

**Six columns of member data had nowhere to land**, including the waiver date
for the roughly 700 members who signed without a contract row, who would have
imported looking as though they had never signed anything.

**Changing an email to one somebody else holds answered 503.** Now 409.

**The API published port 3000 on every interface**, which is a way past Caddy's
TLS and headers on the public host. It is bound to the loopback now, and Caddy
sits behind a `public` profile so a laptop does not start it.

Seven routes had no test beyond the anonymous refusal. They have one now.

### The second pass, nine

The first pass read for correctness. This one read for the things that only go
wrong under load, under failure, or under a clock nobody checked.

**A card id did not survive the round trip.** The adapter reported door events
using the eight character form the device stores, and the API matches
`credentials.token` exactly. A card issued by hand as five hex characters worked
on the door and never appeared on its holder's door log. The adapter maps it
back now, which is what section 6.3 of the specification means by "arrives as a
card id".

**Commands could run backwards.** `returning` makes no promise about row order,
so a lock and an unlock claimed in one pass could reach the controller in either
order. A door left locked when somebody asked for it to be open is the whole
difference between a member getting in and not.

**Freshness trusted the lab host's clock.** `door_state.reported_at` was
whatever the door service sent. A host whose clock is a day out made the door
read as permanently stale, or permanently fresh. The API stamps it now, because
staleness is how long since this side heard from a controller.

**Renaming a door made the controller stale forever.** The row for the old name
stayed with its old timestamp, and the freshness reading takes the oldest. A
state report is now the whole truth about its controller.

**One bad placement lost the whole batch.** An id that is no longer a credential
hit a foreign key and rolled back the placements for every other card in the
pass. Unknown ids are skipped.

**Guessing at a service token could take the API down.** Verifying an Argon2
hash costs 19 MiB and tens of milliseconds by design, the token id is a
guessable name rather than a secret, and nothing under `/door` carries a session
to rate limit. Failures are counted now, and a door service polling every five
seconds never meets the count.

**A reset for an address that exists took measurably longer**, because the
request waited for the mail server, and an SMTP server that was down turned it
into a 503 for members who exist and a 204 for everybody else. The send is not
awaited and cannot reject.

**An admin could lock everybody out of admin.** Taking your own role away or
suspending yourself is refused, because there is no guarantee a second admin
exists and every route that could put it back needs one.

**Two requests racing on a unique index answered 503.** The pre-checks cannot
see a row that has not committed. A duplicate is a 409 now, centrally, so a
route added next year gets it too.

Also proved rather than assumed this round: the CI workflow runs end to end from
a clean checkout with `npm ci` and a schema built from nothing, the import reads
the legacy database in one snapshot rather than one per query, and the list of
log events in `docs/operations.md` matches what the code emits.

### The third pass, sixteen

A line by line read of every file, with each finding proved by running it rather
than by reasoning about it.

**A mistyped URL read as the database being down.** Five routes and two request
bodies passed a path segment straight into a `uuid` column, and Postgres refuses
a value it cannot parse with an error rather than an empty result. So
`/api/credentials/oops` answered 503, which is the status this API keeps for
"something it needed did not answer", and it landed in the log as
`request_failed`. Every id now goes through one check and answers 404.

**A stored hash that would not decode answered 503.** Argon2 throws where bcrypt
returns false, measured both ways. One truncated or hand-edited row would have
answered 503 to every sign in that member tried, and to every poll a service
token made, for as long as the row stood.

**Postgres was published on every interface.** The second pass bound the API to
the loopback and left the database beside it wide open: every password hash,
every door event and the audit log, reachable from outside the host. Verified
with `docker compose ps` before and after.

**A tick interval that was not a number would have flooded the board.**
`setInterval(fn, NaN)` runs every millisecond, measured on node 24.20, against a
single threaded board from 2013 and against the API.

**A stale threshold that was not a number meant nothing was ever stale.**
`Number('soon')` is NaN and every comparison against NaN is false, so the door
would have reported a reading it never took, which is the one thing section 4.7
of the specification says must not happen.

**A door name the adapter did not know opened door one.** `DOOR_ORDER` on the
lab host and `DOORS` on the API are separate settings that can disagree, and the
adapter fell through rather than refusing. Getting this wrong opens the wrong
door, and it did it quietly.

**One malformed event blocked every card read behind it.** A time that is not a
time failed the insert, the whole batch was answered with 503, and the door
service holds a refused batch and offers it again every five seconds forever.
The API now skips what it cannot write and says how many, and the door service
drops a batch the API refuses outright rather than offering it for ever.

**A signing key that would not parse passed startup** and then answered 503 to
every token and every JWKS read for the life of the process, because the
rejected promise is what got cached. The keys are read at startup now, which
also proved the escaped-newline path compose uses had never been exercised.

**The rate limit counter could grow without bound.** A caller already over its
limit still minted a key per request by sending a new address each time. The
address is only counted while the IP is inside its own limit, and the map has a
ceiling.

Smaller: a health port already in use crashed the door service outright; a pass
that failed part way through cleared the faults explaining why; signup had no
upper bound on a password while reset capped at 200; the token response carried
its own copy of the one hour lifetime; `service_tokens.last_seen` was written on
every poll, seventeen thousand times a day, for a value nobody reads to the
second; `DOORS=` meant one door with no name; and a legacy payment with no
amount imported silently as 0.00 rather than as a warning.

### Three things this pass proved were not defects

Worth recording, because each was about to be changed on a wrong belief.

**Caddy replaces a client's `X-Forwarded-For` rather than appending to it**,
measured with a real Caddy in front of a real backend. So taking the first entry
is the true client address behind this Caddyfile, and the per-IP rate limit
cannot be stepped over by sending the header. Only true while no proxy is
trusted, which is the configuration in this repository.

**bcryptjs answers false for a malformed hash** rather than throwing, so the
legacy branch needed no guard even though the Argon2 branch did.

**`sql.begin` hands back the rows a transaction returned, in order**, without
unwrapping them, which is what `change()` has been relying on.

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

The two things that must not break are in section 13 of `CONTRIBUTING.md`. A
verified restorable backup, and the door keeping working when everything here is
down. Every other rule in this repository is negotiable and those two are not.
