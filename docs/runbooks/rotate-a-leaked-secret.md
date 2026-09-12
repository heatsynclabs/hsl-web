# Rotate a leaked secret

There are five. Each has exactly one holder process, and each rotates
differently. Do the one that leaked and nothing else.

## The service token

A door service credential, or a kiosk's. It can do one thing, which is why it
has a scope.

```sh
curl -s -X DELETE localhost:3000/api/service-tokens/door-front -b /tmp/hsl.cookies
curl -s -X POST localhost:3000/api/service-tokens -b /tmp/hsl.cookies \
  -H 'content-type: application/json' \
  -d '{"id":"door-front-2","name":"Front door service","scopes":["door"]}'
```

Put the new value in `SERVICE_TOKEN` on the lab host and restart the door
service. Revoking is a row update, so the old one stops working the moment you
press return. Doors keep working throughout.

## The signing key

```sh
make keys
```

Put both lines in the environment and restart the API. Every JWT issued under
the old key stops verifying immediately. Sessions are untouched, so nobody is
signed out, and a client that wanted a token asks for another one.

To rotate without the gap, publish both keys under different `kid` values first,
sign with the new one, and drop the old after an hour. That is a change to
`api/src/tokens.ts`, which is written to make it easy and does not do it today.

## The database password

```sh
docker compose exec -T db psql -U hsl hsl -c "alter role hsl with password '<new>'"
```

Change `PG_PASS` in `.env` and restart. Both the database and the API read it
from the same place, so they cannot disagree.

## The controller password

It is four hex characters compiled into the firmware as `PRIVPASSWORD`.
Rotating it means flashing the board. It travels in a query string over plain
HTTP on the lab network, so anything on that switch can capture it: the switch
is the real access boundary until the controller is replaced, and that is worth
saying to whoever is asking about the leak.

## The SMTP credential

Change it at the provider, change `SMTP_URL`, restart the API. Nothing else
holds it.

## Afterwards

Every rotation of a service token is in the audit log, because the routes that
do it are audited. A rotation done by hand in the database is not, so write it
down where somebody will find it, and say what leaked and how.
