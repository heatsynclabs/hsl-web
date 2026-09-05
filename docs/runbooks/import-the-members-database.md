# Import the members database

Copies the Rails members database into the new one. You run this once per
environment: once on staging to rehearse, once on production at cutover.

It is the step that decides whether about a thousand people can still sign in
and whether sixty-three people can still open the door. Read the whole page
before you start. Nothing here is dangerous to the old database, because the
import opens it read only, but a rushed cutover is easy to get wrong.

Expect the whole thing to take under an hour, most of it waiting on you rather
than on the computer. The import itself finishes in seconds.

## Before you start

You need:

- A shell on the host running the new stack, with `docker compose` working.
- A Postgres user on the legacy database that can read. It does not need write
  access and should not have it.
- The door controller reachable, so you can read its card table.
- Somebody else awake who can tell members what is happening.

## 1. Prove the backup restores

```
tools/restore-drill.sh
```

Expected output, and nothing else:

```
restore drill passed: 3 rows survived a dump, a drop and a restore
```

If this fails, stop. Section 13 of `CONTRIBUTING.md` makes a proven restore the
gate in front of everything else. Fix the backup path first.

## 2. Take a fresh dump of the legacy database

`tools/backup.sh` backs up the new database, not the old one. The old one is on
its own host, so dump it there:

```
pg_dump -Fc -U members members > members-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Expected output: nothing, and an exit code of 0. A file of tens of megabytes
appears.

Then write down what it holds, so you have something to compare the import's
report against:

```
psql -U members -d members -At -c "select relname, n_live_tup from pg_stat_user_tables order by relname"
```

Expected output includes these, read on 2026-09-01:

```
cards|64
certifications|10
contracts|318
payments|8291
user_certifications|415
users|1061
```

Keep both the dump and the counts. The dump is what you restore from if the
cutover goes badly.

## 3. Read the door controller's card table

The card table dump needs the privileged password, chained onto the command the
way every other request chains it. A bare `?a` answers `Not logged in.` and
nothing else.

```
curl -sS 'http://<controller>/?a&e=<the four hex characters>'
```

Expected: a `<pre>` block, a header line reading `UserNum: Usermask: TagNum:`,
and then two hundred tab separated rows, slot 0 to slot 199. An unwritten slot
reads back as the erased EEPROM, `255` and `FFFFFFFF`.

Save the page. This is the only record of what the door actually believes right
now, and the members database has at least one row that disagrees with it. You
will need it in step 7.

If the tag column reads `********` on every row, the board was built with
`DEBUG` below 2, firmware line 105. Stop and read section 6 of `HANDOFF.md`
before going further: the reconcile loop cannot read a card table it cannot see,
and that is a decision about the firmware rather than about this import.

## 4. Stop the Rails application

Put the old site into maintenance, or stop its web server. The import reads one
consistent snapshot, so a member editing their profile halfway through cannot
corrupt the copy. It will, however, be a change that never reaches the new
system.

Check that it is really stopped:

```
curl -sS -o /dev/null -w '%{http_code}\n' https://<old-host>/
```

Expected output: `503`, or a connection failure. Anything in the 200s means it
is still serving.

## 5. Put the dump where the import can reach it, and build an empty schema

Everything from here runs in containers. The import runs inside the compose
network, because that is the only place the database is reachable: `compose.yaml`
publishes no port for `db`, and the connection string it uses carries the
password from `secrets/db_password`. Running `node tools/import/main.ts` from
the host does not work and is not worth making work.

```
cp members-<stamp>.dump legacy/members.dump
make legacy-restore
```

Expected output ends with `restored. Now run: make import ARGS=--dry-run`.
`legacy/` is gitignored and excluded from the Docker build context, so the dump
cannot reach a commit or an image layer.

Then an empty target:

```
make reset CONFIRM=yes
```

`make reset` deletes the members database volume and rebuilds the schema from
the migrations. It refuses without `CONFIRM=yes` on a host whose `.env` says
`HSL_SCHEME=https`, because on any other day that command is a disaster. At
cutover the database is empty and wiping it is the point.

Expected: compose stops the stack, removes the volume, and brings `db`,
`migrate`, `api` and `web` back. Confirm the schema is really there and really
empty:

```
docker compose exec -T db psql -U hsl -d hsl -At \
  -c "select count(*) from information_schema.tables where table_schema='public'" \
  -c 'select count(*) from "user"'
```

Expected: `12`, then `0`. Twelve tables and no members. The import refuses a
database that already holds members, and says so:

```
The target database already holds 5 rows in user. The import runs once into an
empty schema. Nothing was written.
```

## 6. Dry run

```
make import ARGS=--dry-run
```

This does the entire import, prints both reports, and then rolls everything
back. Nothing is committed. Run it as many times as you like.

Expected output is two blocks. First the preflight:

```
Preflight:
  NOTICE   no password set (31)
           These members get a member row and no credential, as they had before. Legacy ids: 8, 13, 14, ...
  NOTICE   card slot the reader cannot see (1)
           checkUser stops at slot 199, so this card does not open the door today ... Legacy ids: 200.
  REFUSAL  orphan certification grant (1)
           The member or the tool no longer exists. Accepting orphans skips these rows. Legacy ids: 216.
  REFUSAL  orphan payment (1)
           A payment belonging to nobody. Accepting orphans skips these rows. Legacy ids: 268.
  NOTICE   payment with no amount (264)
           Recorded as zero cents with a note saying the legacy row held no amount. Legacy ids: 1, 4, 5, ...
  REFUSAL  orphan signed release (65)
           A signed release belonging to nobody. ... Legacy ids: 45, 84, 130, ...
  NOTICE   release with no stored document (102)
           The waiver row records that the document is missing rather than naming one. Legacy ids: 3, 7, 8, ...
```

Then, because three checks refused, it stops without writing:

```
Preflight refused: 3 checks failed. Nothing was written. Fix the rows above in
the legacy database, or read the list and pass --accept-orphans if every
remaining refusal is an orphan you are content to leave behind.
```

Those counts are what production held when it was read on 2026-09-01. If your
numbers are close to these, you are looking at the same database. If a refusal
appears that is not in the list above, go to step 12.

## 7. Decide about the orphans and about slot 200

Two decisions, and they are yours rather than the script's.

**The orphan rows.** The legacy database has no foreign key constraints
anywhere, so 67 rows point at members who no longer exist: 65 signed releases,
one payment and one certification grant. Nothing can be done with them, because
there is nobody to attach them to. They stay in the old database, which you keep
restorable in step 11. Passing `--accept-orphans` skips them and lists every one
it skipped. Read the list first.

**The card at slot 200.** Compare it against what the controller told you in
step 3. The firmware writes slot 200 and never reads it, so that card does not
open the door today even though the members database says its holder has access.
The import keeps the slot exactly as it is, because renumbering a slot is how
you silently hand somebody else's door permission to a member. Moving that card
to a free slot below 200 is a separate job, done deliberately, after the import,
with the member present to test their card.

## 8. Dry run again, with the decision made

```
make import ARGS="--dry-run --accept-orphans"
```

The three refusals now read `ACCEPTED`, and the second block appears:

```
Reconciliation:
  what                                        legacy  imported   skipped
  members                                       1061      1061         0
  credentials                                   1030      1030         0
  cards                                           64        64         0
  members with card access (permission 1)         63        63         0
  certifications                                  10        10         0
  certification grants                           415       414         1
  payments                                      8291      8290         1
  signed releases                                318       253        65

Dry run. Everything was rolled back.

Nothing was committed.
```

The left column is read from the legacy database as the import runs. The figures
above are the ones production held on 2026-09-01; the right hand columns are what
they have to add up to, not a measurement of your run.

Check every line. `legacy` must equal `imported` plus `skipped` on all eight, and
`skipped` must be zero everywhere except the three you accepted. A line that does
not add up is printed with `DISAGREES` after it and the import refuses to claim
success.

Compare the left column against the manifest from step 2. They come from
different places and should say the same thing.

## 9. Run it for real

```
make import ARGS=--accept-orphans
```

Same two blocks, then:

```
Imported and committed.
```

The exit code is 0. If anything at all went wrong, the exit code is 1, the
message says what happened, and nothing was committed. There is no half
imported state to clean up.

## 10. Check it by using it

Reading rows is not enough. Do these three things.

**Sign in as a real member.** Ask an admin who is standing next to you for their
own address and password, or use your own. Signing in proves the bcrypt hash and
the `local:credential` issuer at the same time, and those are the two things that
would lock out the entire membership without any error worth reading.

Expected: the members app loads and shows their own name.

**Look at the card table the door service will write.**

```
curl -sS -H "authorization: Bearer $(cat secrets/door_token)" \
  https://<domain>/api/door/card-table
```

Expected: card numbers of exactly eight uppercase hex characters, and slots
matching what the controller told you in step 3. The card at slot 200 is
deliberately absent from this list, because the reader cannot see it.

**Count the members who can drive the doors.**

```
docker compose exec db psql -U hsl -d hsl -At -c 'select count(*) from "user" where card_access'
```

Expected: `63`, matching the reconciliation line.

## 11. Afterwards

- Leave the old database running, read only, for a year. Door history before
  cutover lives only there, and `docs/decisions/0010-what-the-import-carries.md`
  says a report that needs it is a one-off query against the archive.
- Keep the dump from step 2 with the rest of the backups.
- Tell members the old site is gone and the new one has their password.

## 12. When it refuses

The import prints what it found and writes nothing. Work through the list.

| It says | It means | Do |
|---|---|---|
| `duplicate email` | Two members share an address under lowercase comparison | Merge them in the old system with the merge tool, then start again at step 6 |
| `blank name` or `blank email` | A row the new database cannot represent | Fix the row in the old system |
| `unexpected password hash` | A hash that is not bcrypt | Look at the row. If the password is unusable, blank it: that member gets a member row with no credential and uses password reset |
| `card number is not eight hex characters or fewer` | A card number the controller cannot store | Fix it in the old system against the physical card, not by guessing |
| `orphan card` | A card belonging to nobody. This one is never skipped | Find out whose card it is. It is door access |
| `card slot outside the EEPROM table` | A slot below 0 or above 200 | Stop and ask. This should not exist |
| `The target database already holds ...` | You are pointing at a database that has been imported already | Check `DATABASE_URL`. Rebuild the target if you meant to start over |
| `Read N rows from legacy ... but the table holds M` | The old database changed under the read | Go back to step 4. The Rails app is still running |
| `Card slots changed during the import` | The thing this whole script exists to prevent | Nothing was committed. Do not run it again. Bring this to the list before touching anything |
| `The two databases disagree` | The counts did not add up | Nothing was committed. The lines marked `DISAGREES` say which table |

## 13. If you need to undo it

Nothing was written to the old database at any point, so there is nothing to
undo there.

For the new one:

```
make reset CONFIRM=yes
```

Then start again at step 5. Bring the Rails application back up first if members
are waiting.

Do not reach for `drop schema public cascade` and a migrate instead. drizzle
records what it has applied in its own `drizzle` schema, which that command
leaves behind, so `drizzle-kit migrate` then prints
`migrations applied successfully` over a database with no tables at all and the
import dies on `relation "user" does not exist`. `make reset` deletes the
volume, which takes both schemas with it. If something else in the database
means you cannot delete the volume, drop both by name:

```
docker compose exec -T db psql -U hsl -d hsl \
  -c 'drop schema public cascade' -c 'drop schema drizzle cascade' -c 'create schema public'
docker compose run --rm migrate
```
