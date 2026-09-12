# The disk is full

Symptom: Postgres refuses writes, or the API answers 503 to everything, or
`docker compose up` fails.

Nobody is locked out of the building. Cards are on the controller.

## 1. Find out what is using it

```sh
df -h
du -sh /var/lib/docker/* | sort -h | tail
docker system df
```

## 2. The three things that grow

**Backups.** `scripts/backup.sh` prunes dumps older than thirty days, and only
if it ran. If `BACKUP_DESTINATION` is unset they are all on this host, which is
the situation this step exists for.

```sh
ls -lh backups/ | tail
```

Safe to delete, oldest first, once they are somewhere else. If they are not
somewhere else, that is the actual problem.

**Docker images.** Every deploy leaves the previous one.

```sh
docker image prune -a --filter 'until=168h'
```

Safe. Rollback pulls the previous tag from the registry again.

**Door events.** Two years of them, deleted by the nightly job. If that job has
not been running, this is where the space went.

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select count(*), min(at) from door_events"
make nightly
```

Expect a count that grows with how busy the building is, not with time. Millions
of rows means something is writing status as events, which this schema is built
not to do, and is worth understanding rather than just deleting.

## 3. What not to delete

Not the `db` volume. Not `caddy_data`, which holds the certificate and the ACME
account key. Not `audit_log`, which the database will refuse anyway.

Postgres does not return disk space to the filesystem after a delete without a
`vacuum full`, which takes an exclusive lock on the table. For `door_events`,
where the rows are gone and the space is reused by the next two years of rows,
leave it.

## 4. Afterwards

Set `BACKUP_DESTINATION` so the dumps leave this host, and check the nightly job
is in cron on the public host:

```
0 3 * * *  cd /srv/hsl-web && make nightly >> /var/log/hsl-nightly.log 2>&1
```

A backup on the host it protects is not a backup, and this is the failure that
makes that concrete.
