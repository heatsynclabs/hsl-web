# Run the door service

With the simulated controller on a laptop, or with the real one at the lab. The
only difference is two environment variables.

## 1. Get an admin account

The seed gives you one. `ada@example.invalid`, password
`correct-horse-battery`.

```sh
make up && make migrate && make seed
```

## 2. Mint a service token

The secret is shown once and stored as a hash. There is no route that reads it
back, because there is no row that holds it.

```sh
curl -s -X POST localhost:3000/api/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.invalid","password":"correct-horse-battery"}' \
  -c /tmp/hsl.cookies

curl -s -X POST localhost:3000/api/service-tokens -b /tmp/hsl.cookies \
  -H 'content-type: application/json' \
  -d '{"id":"door-front","name":"Front door service","scopes":["door"]}'
```

Expect: `{"id":"door-front", ..., "token":"door-front.<secret>"}`. That whole
`token` value is `SERVICE_TOKEN`.

## 3. Start the controller

Simulated, on a laptop:

```sh
make simulator
```

Expect: `{"evt":"simulator_listening","port":8080}`.

Real, at the lab: nothing to start. Find its address and the four hex character
password. `CONTROLLER_PASSWORD` is the four characters, `1234`, and not the C
literal `0x1234` and not `0000`. The service refuses to start on anything else
and says why.

## 4. Start the door service

```sh
API_URL=http://localhost:3000 \
SERVICE_TOKEN=door-front.<secret> \
CONTROLLER_ID=openaccess \
CONTROLLER_URL=http://localhost:8080 \
CONTROLLER_PASSWORD=1234 \
npm --prefix door start
```

Expect one line, then quiet:

```
{"evt":"door_started","controller":"openaccess","kind":"openaccess", ...}
```

## 5. Check it arrived

```sh
curl -s localhost:3000/api/door -b /tmp/hsl.cookies
```

Expect the controller, both doors, `"stale": false`, and the four capabilities.
If `stale` is true, the door service is not reporting. Go to
`the-door-service-will-not-talk-to-the-controller.md`.

## 6. Open a door

```sh
curl -s -X POST localhost:3000/api/door/command -b /tmp/hsl.cookies \
  -H 'content-type: application/json' -d '{"action":"open","door":"front"}'
```

Expect `202` and a command id, then within five seconds a `command` row in
`door_events` with `"outcome":"done"`.

## 7. Enrol a card

Against the simulator, hold a card to the reader in software. There is no such
command on real hardware: at the lab, hold the card to the reader.

```sh
curl -s -X POST 'localhost:8080/present?tag=0000FFFF'
```

Within five seconds:

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select kind, token from door_events order by id desc limit 1"
```

Expect `presented | 0000FFFF`. That card id is what goes into
`POST /api/credentials`, and it is the value to copy rather than retype: the API
has no format rule for a card id, so a value typed by hand with different
padding is a different card.
