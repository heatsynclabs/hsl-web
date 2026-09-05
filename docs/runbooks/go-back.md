# Go back

For when a deploy or a cutover has gone wrong and the fastest safe thing is to
put back what was working. Read the whole page first: the three situations below
need different answers and the wrong one loses data.

Nothing here touches the door controller. Physical cards keep opening the
building throughout, because the controller holds its own card table in EEPROM.
If cards are not working, this is the wrong page: that is the controller or the
readers, and nothing in this repository will fix it.

## Which situation is this

| What happened | Go to |
|---|---|
| A deploy of new code is broken. The database is fine | 1 |
| The database is wrong: a bad migration, a bad import, data lost | 2 |
| The cutover was a mistake and the lab should be back on the Rails app | 3 |

## 1. Put back the previous code

The database is untouched, so this is a code problem only.

Find the commit that was running. `docker compose ps` does not record it, so
look at the host's checkout:

```
git -C /srv/hsl log --oneline -5
```

Expected: the deploy history, newest first. The one below the current `HEAD` is
usually the one you want.

```
cd /srv/hsl
git checkout <the previous sha>
make up
```

Expected: `make up` builds, runs the migrations, and starts the stack.
Migrations run before anything is recreated, so if the older code cannot apply
them the deploy stops with the site still up.

A migration that already ran is not undone by checking out older code. Drizzle
applies migrations forward only. If the newer schema breaks the older code, this
is situation 2 rather than situation 1.

Prove it came back:

```
docker compose ps
curl -sS https://<domain>/space_api.json
```

Expected: `db` and `api` healthy, `web` running, and a JSON document with `open`
and `status`.

## 2. Put back the database

You need a dump. `make backup` writes one to `/var/backups/hsl` and the cron
line in `docs/operations.md` runs it nightly.

```
ls -lt /var/backups/hsl
```

Expected: `hsl-<stamp>.dump` and `roles-<stamp>.sql` pairs, newest first, mode
0600 in a 0700 directory.

Stop the API first, so nothing writes while the database is being replaced:

```
cd /srv/hsl
docker compose stop api web
```

Expected: both stop. The site is down from here until the last step, and
`/space_api.json` stops answering, so the lab website reads whatever it does
when the URL fails.

Check the dump before you rely on it. `tools/restore.sh` restores into a
throwaway copy called `hsl_restore_check` and never touches the live database,
which is exactly what you want first:

```
./tools/restore.sh /var/backups/hsl/hsl-<stamp>.dump
```

Expected: it prints the row counts in the restored copy. Read them. A `user`
count near whatever the lab has means the right dump; a count of zero means the
wrong file, and you should try an older one before going any further.

Now put it back for real. There is no script for this on purpose: it destroys
the current members database, and it should be four commands somebody typed
rather than one they ran by accident.

```
docker compose exec -T db dropdb -U hsl --if-exists hsl_before_restore
docker compose exec -T db psql -U hsl -d postgres -c 'alter database hsl rename to hsl_before_restore'
docker compose exec -T db createdb -U hsl hsl
docker compose exec -T db pg_restore -U hsl -d hsl --no-owner --no-acl < /var/backups/hsl/hsl-<stamp>.dump
```

Expected: each answers with no error. The database you are replacing is renamed
rather than dropped, so if the dump turns out to be wrong the last hour is still
on disk as `hsl_before_restore`. Drop it deliberately, later, when you are sure.

The roles file beside the dump is only needed when restoring into a fresh
Postgres cluster. Restoring into this one, the `hsl` role already exists.

```
docker compose exec -T db dropdb -U hsl --if-exists hsl_restore_check
docker compose up -d
```

Expected: `migrate` exits 0 and `api` becomes healthy.

Then check by using it, not by reading rows. Sign in as a member you can ask,
and open the admin directory.

**The door service does not need anything from you.** It reads the card table
from the API on a timer, and a members database that answers with no card rows
at all is refused rather than acted on, so an empty or half restored database
cannot erase the controller. Once the restore is done the next pass writes the
cards back.

## 3. Go back to the Rails application

Only if the cutover itself was wrong. The old system is authoritative again from
the moment you do this, and anything a member changed in the new system since
cutover is lost unless somebody copies it across by hand.

1. Bring the Rails application out of maintenance and confirm it serves:

   ```
   curl -sS -o /dev/null -w '%{http_code}\n' https://<old-host>/
   ```

   Expected: `200`.

2. Point DNS back at the old host, or take the new hostname down:

   ```
   cd /srv/hsl
   docker compose stop web
   ```

   Expected: the new site stops answering. Leave `db` running: it holds
   everything the cutover imported and you may want it.

3. Tell members, in whatever the lab uses. They were told the site moved.

4. Write down what went wrong before you sleep. The next attempt is easier if
   the reason is on paper rather than in somebody's memory.

Nothing was written to the Rails database at any point. The import opens it read
only, which is why going back is possible at all.

## What this page does not cover

Rotating a leaked secret, and moving the card at slot 200. Both are deliberate
jobs done in daylight, not recoveries.
