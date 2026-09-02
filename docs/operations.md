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

```
git clone https://github.com/heatsynclabs/hsl-web
cd hsl-web
cp .env.example .env
make secrets                # writes secrets/, never overwrites an existing file
make up
```

Edit `.env` before `make up`. For a real deployment that means
`HSL_PUBLIC_ORIGIN=https://members.heatsynclabs.org`, `HSL_DOMAIN` to match
without the scheme, `HSL_SCHEME=https`, and the ports back to 80 and 443.

`HSL_PUBLIC_ORIGIN` has to be the exact URL a browser types, port and all. The
session cookie is checked against it, so a mismatch refuses every sign in with
"invalid origin" and nothing in the logs says why.

Then put the real SMTP URL in `secrets/smtp_url`. `make secrets` writes a
placeholder pointing at the development mail catcher, and the API refuses to
start on https while it is still that, because password reset is the only way in
for a member with no password.

`make up` is `docker compose up -d --build`. Compose refuses to start when a
value in `.env` is missing, so a misconfigured host fails at
`docker compose config` with a readable message rather than at runtime.

Migrations run as their own container that the API waits on. Two API containers
can never race to migrate, and a failed migration stops the deploy rather than
leaving a service running against a half migrated schema.

## The lab host

```
cd infra/door
cp .env.example .env        # CONTROLLER_URL and API_URL
mkdir -p secrets
printf '%s' '<the controller password>' > secrets/controller_password
printf '%s' '<the door token from the public host>' > secrets/door_token
chmod 600 secrets/*
docker compose up -d --build
```

The door token is the same value as `secrets/door_token` on the public host. It
is the only credential the two hosts share.

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

`pg_dump` refuses to read a server newer than itself, so the backup runs
`pg_dump` from inside the database container. Do not replace it with a locally
installed `pg_dump`.

Schedule it from host cron rather than a sleeping container, so it is visible in
`crontab -l`:

```
17 3 * * * cd /srv/hsl && ./tools/backup.sh >> /var/log/hsl-backup.log 2>&1
```

A backup nobody has restored is not a backup. `tools/restore-drill.sh` runs in CI
on every change: it loads a fixture, dumps it, drops the database, restores it,
and fails if the rows do not come back.

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

Start with the Caddy log. It is the only one that says which layer is down: a
line reading `dial tcp 172.21.0.4:3000: connect: connection refused` means the
API is not answering, and you have the answer before you have opened anything
else. It redacts the Cookie and Authorization headers, so it is safe to paste
into a chat while you ask for help.

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
