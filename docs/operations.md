# Operations

## The two hosts

The public host runs `compose.yml`: Postgres 17, the API, and Caddy for TLS. The
lab host runs `compose.lab.yml`: the door service and nothing else. They never
connect the other way round.

Every container has a memory and PID limit, and a log with a size cap. One
runaway process should not take the host down and the door status with it.

### The public host

```sh
git pull
docker compose pull
docker compose run --rm api node scripts/migrate.ts
docker compose --profile public up -d
```

`--profile public` is what starts Caddy. Without it you get the database and the
API with the API bound to the loopback, which is the right thing on a laptop and
not a deployment.

Migrations run before the new API starts, and they are forward only, so each one
has to leave the previous version of the code working: add a column one release
before anything uses it, drop it one release after. Rollback is redeploying the
previous tag.

### The lab host

```sh
docker compose -f compose.lab.yml pull
docker compose -f compose.lab.yml up -d
```

It pulls on its own schedule, because it is on a different network and should
not be reachable from CI.

Five variables and no volume. Reimage the machine, give it those five, and it is
back. `docs/runbooks/run-the-door-service.md` is the whole sequence including
minting the service token.

## Environment

`api/src/config.ts` is the complete list of what the API reads, with each
default and each refusal beside it. `.env.example` is the same list as a file to
copy. Two refusals are worth knowing before a deploy:

- No `DATABASE_URL` and the API does not start.
- `ISSUER` on https and no `SMTP_URL`, `SIGNING_KEY` or `SIGNING_KEY_PUBLIC`,
  and the API does not start. A deployment that cannot send mail cannot reset a
  password, and a member locked out has no other way in.

`make keys` prints an RSA pair. All secrets live in repository secrets and reach
the host as environment variables. No config file on a server holds a
credential.

## Backups

Nightly `pg_dump` to object storage off the host it protects, thirty daily and
twelve monthly retained. `scripts/backup.sh` does the dump and the pruning and
copies the result to `BACKUP_DESTINATION` if one is set. Without that variable
the dumps stay on the host they protect, and the script says so rather than
implying otherwise.

Caddy's volume is included, because it holds the TLS certificate and the ACME
account key. Losing it costs a new certificate rather than data.

Restore is tested quarterly with `scripts/restore.sh`, which restores into a
scratch database and never touches the live one. A backup that has never been
restored is not a backup, and row counts are not a restore: point a staging API
at the scratch database and sign in as a real migrated member.

## The nightly job

`scripts/nightly.sql`, once a day, by cron on the public host.

```
0 3 * * *  cd /srv/hsl-web && make nightly >> /var/log/hsl-nightly.log 2>&1
```

It expires sessions, deletes door events older than two years, clears expired
reset tokens, and prints how many legacy bcrypt hashes are left. When that
number reaches zero, delete the bcrypt branch in `api/src/auth.ts` and the
dependency with it.

## Logging

Structured JSON to stdout, one `evt` field per line, collected by Docker with a
size limit set.

```
api    login_ok  login_fail  password_upgraded  password_changed  rate_limited
       member_created  member_updated  cert_granted  cert_revoked
       credential_issued  credential_revoked  payment_recorded
       door_command  door_fault  duplicate_refused  request_failed
       listening  signing_key_generated  mail_not_sent  mail_failed

door   door_started  door_link_down  door_link_up  using_simulated_controller

simulator   simulator_listening  device_request
```

That list is the whole of it, checked against the source rather than written
from memory. `mail_failed` is the one worth an alert: a member asked for a reset
link and did not get one, and the request answered 204 either way.

Passwords, session tokens, service token secrets and placements never appear.
Card ids do, because `door_events` is the debugging tool for the door.

```sh
docker compose logs -f api | grep door_
docker compose logs -f api | grep '"evt":"login_fail"'
```

## Health

`GET /healthz` is liveness and deliberately does not check Postgres. An API that
is up and cannot reach the database should stay in the load balancer and answer
503 per request, so the failure reads as a broken database rather than as a
missing container. `app.onError` turns a failed query into a 503 with a sentence
rather than a stack trace.

The door service answers the same thing on `HEALTH_PORT`, bound to localhost,
and reports 503 with the last error when its last pass failed.

## What breaks and what happens

| Failure | Effect |
| --- | --- |
| `api` down | Nobody signs in. Cards still open doors. Remote control unavailable |
| Postgres down | Same |
| Link to the lab down | Card table goes stale, doors keep working for everyone already provisioned, remote control returns 503, public status goes stale rather than wrong |
| Door service down | Same as above |
| Controller down | Doors fail to whatever the hardware does. Not this system's decision |
| Caddy down | Everything unreachable, nothing lost |
| Signing key lost | Regenerate. Issued JWTs stop verifying for up to an hour. Sessions unaffected |
| Members database emptied | The next pass refuses to clear the controller and says so. Cards keep working |

A stale card table is the correct failure. The building stays usable and the fix
is not urgent.

## Runbooks

The 2am versions, in `docs/runbooks/`.

| | |
| --- | --- |
| `import-the-members-database.md` | The one-time legacy import |
| `go-back.md` | Undo a cutover |
| `run-the-door-service.md` | Stand the door service up, with or without hardware |
| `the-door-service-will-not-talk-to-the-controller.md` | What to check, in order |
| `rotate-a-leaked-secret.md` | Any of the five |
| `the-certificate-did-not-renew.md` | Caddy and ACME |
| `the-disk-is-full.md` | What is safe to delete |
