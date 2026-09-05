# Operations

Everything runs under Docker Compose. Nothing here assumes a particular hosting
provider.

Two hosts. The public host runs Postgres, the API and Caddy. The lab host runs
the door service, on the LAN with the controller, and opens no inbound port.

## Before the first deploy

The current members server, `hsl-web`, is 32 bit CentOS 6.8 on kernel 2.6.32 and
cannot run Docker. A machine has to be chosen and somebody has to own it. That is
a custody decision rather than a technical one, and it blocks deployment but not
development.

## The public host

You need a machine with Docker, a DNS name already pointing at it, and ports 80
and 443 reachable. Caddy asks Let's Encrypt for a certificate on first start, so
the name has to resolve before you begin or the first request answers with a TLS
error and nothing says why.

```
git clone https://github.com/heatsynclabs/hsl-web
cd hsl-web
cp .env.example .env
```

Now edit `.env`, before anything is started. For a real deployment:

```
HSL_PUBLIC_ORIGIN=https://members.heatsynclabs.org
HSL_DOMAIN=members.heatsynclabs.org
HSL_SCHEME=https
HSL_HTTP_PORT=80
HSL_HTTPS_PORT=443
```

and delete the `COMPOSE_PROFILES=dev` line, which starts the development mail
catcher. `HSL_PUBLIC_ORIGIN` has to be the exact URL a browser types, port and
all: the session cookie is checked against it, and a mismatch refuses every sign
in. When that happens the API logs `Invalid origin: <what was sent>` beside the
value it expected, so `docker compose logs api` is the place to look.

Then the secrets:

```
make secrets                # writes secrets/, never overwrites an existing file
```

That writes four files and leaves the directory at 0700 with the files at 0644.
The modes are deliberate: Compose mounts a file secret as a plain bind mount and
ignores `uid`, `gid` and `mode`, and the service images run as the `node` user,
uid 1000. A 0600 file owned by the deploying user is unreadable inside the
container, and the deploy dies with `EACCES` on a secret. The private directory
is what keeps other host users out.

One of the four is a placeholder. Replace it:

```
printf '%s' 'smtps://user:password@smtp.example.org:465' > secrets/smtp_url
```

`make secrets` writes `smtp://mail:1025`, the development mail catcher, and the
API refuses to start on an https origin while that value is still there. It says
so by name. Password reset is the only way in for the 31 imported members who
have never had a password, so a deployment that cannot send mail is a deployment
that locks people out silently.

```
make up
```

`make up` builds the images, runs the migrations as their own step, and only
then starts the stack. The migration runs first on purpose: `docker compose up`
recreates the api and web containers before it runs migrate, so a migration that
fails would take the running site down and leave nothing to fall back on.

## The first admin

A fresh install has nobody who can reach the admin portal, and every route that
could grant admin already needs one. There is one door in from outside the
application and it needs a shell on the host.

If you are importing the old members database, do that first: the import refuses
to write into a database that already holds members, so a signup made before the
import blocks it. See `docs/runbooks/import-the-members-database.md`. Then:

```
make admin EMAIL=someone@heatsynclabs.org
```

with the address of a member the import carried.

On a lab with no old database, somebody signs up at `https://<domain>/signup`
first, choosing their own password, and then you run the same command with their
address. `make admin` refuses to create a member: an account has to belong to
the person who set its password.

## Proving the deploy worked

Four checks, in this order. Each one fails differently, so a failure tells you
where to look.

```
docker compose ps
```

Expected: `db` healthy, `api` healthy, `web` running, `migrate` exited 0. No
`mail`.

```
curl -sS https://<domain>/space_api.json
```

Expected: a JSON document with `open` and `status` keys. This is the URL the lab
website and the ESP8266 status LED read, so it answering is the contract with
things outside this repository. A TLS error here means DNS or the certificate; a
502 means the API is not up.

Sign in through the browser as the admin from the step above. That proves the
cookie, the origin and the database together, which is what nothing else proves.

Ask for a password reset for an address you control, and read the mail. Nothing
else tells you the SMTP URL is right, and the guard at boot only proves it is not
the placeholder.

## The lab host

```
cd infra/door
cp .env.example .env        # CONTROLLER_URL and API_URL
mkdir -p secrets && chmod 700 secrets
printf '%s' '<the controller password>' > secrets/controller_password
printf '%s' '<the door token from the public host>' > secrets/door_token
chmod 644 secrets/*
docker compose up -d --build
```

The door token is the same value as `secrets/door_token` on the public host. It
is the only credential the two hosts share. The modes match the public host and
for the same reason: the container reads these as uid 1000, and the private
directory is what keeps other host users out.

The controller password is the four hex characters the board reads after `e=`,
not the C literal from the sketch. `PRIVPASSWORD` is declared as `0x1234`, and
the value to write here is `1234`. The service refuses to start on anything
else and says so.

## Development

The reverse proxy does not run on a laptop, which removes the whole local TLS
problem.

```
cp .env.example .env
echo 'COMPOSE_FILE=compose.yaml:compose.dev.yaml' >> .env
make secrets
docker compose up -d db api mail
pnpm dev
```

Postgres is on `127.0.0.1:5432`, the API on `127.0.0.1:3000`, the mail catcher's
inbox on `127.0.0.1:8026`, and Vite serves each app with its own proxy pointing
`/api` at the API.

To run the built apps behind Caddy instead, which is what production does, leave
`COMPOSE_FILE` out and use `make up`. `README.md` covers that path and the seed
data that goes with it.

The override file is named `compose.dev.yaml` rather than
`compose.override.yaml` on purpose. An override file merges automatically, so a
production host with the repository checked out would silently pick up
development settings.

## Backups

```
make backup                       # writes a dump and a roles file
./tools/restore.sh <dump file>    # restores into a throwaway copy and counts rows
```

`tools/restore.sh` checks a dump. It never writes over the live database, which
is deliberate. Putting a database back is in `docs/runbooks/go-back.md`, as
commands somebody types rather than a script they can run by accident.

`pg_dump` refuses to read a server newer than itself, so the backup runs
`pg_dump` from inside the database container. Do not replace it with a locally
installed `pg_dump`.

Schedule it from host cron rather than a sleeping container, so it is visible in
`crontab -l`:

```
17 3 * * * cd /srv/hsl && ./tools/backup.sh >> /var/log/hsl-backup.log 2>&1
```

The dump and the roles file are written 0600 in a 0700 directory. They hold
every member's name, address, phone number, emergency contact, payment history
and password hash, so they are treated the way `make secrets` treats a secret.

A backup nobody has restored is not a backup. `tools/restore-drill.sh` runs in
CI on every change: it loads a fixture into a throwaway Postgres, dumps it,
drops the database, restores it, and fails if the rows do not come back.

What it proves is that `pg_dump` and `pg_restore` round trip on the image this
stack runs. It does not call `tools/backup.sh` or `tools/restore.sh`, so it is
not proof that those two scripts work. Running `make backup` and then
`./tools/restore.sh` on the dump it wrote is, and it is worth doing once on the
host before you rely on the cron line.

## Deploying a change

By hand, for now.

```
ssh <host>
cd /srv/hsl
git pull
make up
```

Four lines, and any volunteer can run them. A deploy workflow is worth building
when a second person needs to deploy, or after somebody has deployed the wrong
thing at 2am. Until then it is a dormant workflow holding an SSH key.

## When something is wrong

The door is the part that matters, so start by working out which layer is down.

Physical cards still open the door when everything here is down, because the
controller holds its own card table. If cards are not working, the problem is the
controller or the readers, and nothing in this repository will fix it.

On the public host:

```
docker compose ps                        # what is running, and what keeps restarting
docker compose logs -f web               # Caddy. This is the one that names the failure.
docker compose logs -f api
curl -s https://<domain>/space_api.json  # the public status contract
```

Start with the Caddy log. It carries one line per request and an error line
naming the layer that failed: `dial tcp 172.21.0.4:3000: connect: connection
refused` means the API is not answering, and you have the answer before you have
opened anything else. It redacts the Cookie and Authorization headers to the
literal `REDACTED`, checked against the running container rather than assumed,
so it is safe to paste into a chat while you ask for help.

Caddy writes nothing per request unless it is asked to, and the `log` directive
in `infra/Caddyfile` is what asks. If that log is silent on a stack that is
serving requests, you are looking at an older image than this commit.

On the lab host, which is a different machine:

```
docker compose logs -f door
curl -s http://localhost:8080/healthz
```

Running the door commands on the public host prints nothing and looks like a
broken door service. There is no door container there.

If the door service cannot reach the API, remote control returns 503 and the card
table goes stale. The building stays usable. This is the designed failure and it
is not urgent.

## Secrets

Four on the public host: the database password, the session signing key, the
door token and the SMTP URL. One on the lab host: the controller password, plus
the same door token.

They live as files under `secrets/`, mounted at `/run/secrets/`, which keeps them
out of the process environment and out of `docker inspect`. `secrets/` is
gitignored.

Keep one copy in whatever password manager the lab already uses. What each loss
costs:

| Secret | If lost |
|---|---|
| Session signing key | Everyone is signed out. Generate a new one. |
| Database password | Recoverable from inside the container. |
| Door token | The two hosts stop talking. Rotate on both. |
| SMTP URL | Password reset mail stops. Nobody who forgets a password can get back in. |
| Controller password | Read it from the firmware, or reflash. Rotating it means changing `PRIVPASSWORD` in the firmware and the secret file together. |

No secret here has the property that losing it makes data permanently unreadable.
That was deliberate.

## Upgrading Node

The images pin `node:24.20-alpine`. Node 26 does not bundle corepack, so when the
base image moves, `RUN corepack enable` in each Dockerfile becomes
`RUN npm i -g pnpm@<the version in package.json>`.

## What is in the images

Each service image is `node:24.20-alpine` plus one self-contained file per entry
point, and no `node_modules` at all. The API image is 240 MB, of which 231 MB is
the base image and 6.9 MB is `/app`. The door image is 232 MB on the same base.

The API image carries two things beside the bundles: `/app/space_api.template.json`,
which `SPACE_API_TEMPLATE_PATH` points at, and `/app/migrations`, which the
migrate container applies. The door image carries neither.

`pnpm bundle` in each service is what builds those files, and
`docs/decisions/0013-services-ship-as-a-bundle.md` records why it replaced
`pnpm deploy`. A stack trace from production therefore points into a bundled
file. Rebuild the same commit to get the same bundle and the same line numbers.
