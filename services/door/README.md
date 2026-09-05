# @hsl/door

The one piece that touches hardware. It runs on the lab host, on the LAN with
the door controller, and it is the only thing in this repository that opens a
socket to the controller.

Three jobs:

- **Reconcile.** On a timer it fetches the card table from the API, reads the
  controller's card table back, and writes the difference. A card keeps its
  slot, always. The slot is an EEPROM address, and moving one hands a member
  somebody else's door permission.
- **Report.** It posts the controller status and drains the event log to the
  API, which is where `/space_api.json` and the status LED get their answer.
- **Drive.** It runs the commands the API queued, and answers a small local HTTP
  surface on loopback for status and control.

Every connection to the members API is outbound. Nothing on the public internet
reaches into the lab, per `docs/decisions/0005-the-door-service-is-outbound-only.md`.
When the link is down the card table goes stale, remote control answers 503, and
physical cards keep opening the door, because the controller holds its own card
table in EEPROM.

## It holds the controller password

`CONTROLLER_PASSWORD` is read by this process and no other. It is the privileged
password for the board, `PRIVPASSWORD` in the firmware, and it goes into the
query string of an HTTP request on the lab LAN. What that means in practice:

- Nothing else in this repository reads it. The API never speaks the wire
  protocol and never sees the password. Any code that needs the door to do
  something asks this service.
- It never reaches a log line or an error message. Every query goes through
  `redactPassword` before it can be printed, and there is a test for it.
- On the lab host it lives as a file under `secrets/` mounted at
  `/run/secrets/controller_password`, so it stays out of the process environment
  and out of `docker inspect`. `CONTROLLER_PASSWORD` as a plain variable is the
  development path.
- Every command chains the login onto the command as a trailing `&e=PASS`. The
  firmware logs itself out after a chained command. A bare `?e=PASS` leaves the
  whole lab LAN privileged until something logs out or the board reboots, so
  this service never sends one, and a test asserts it.
- The password is four hex digits sent in a query string over plain HTTP, which
  the firmware cannot improve on. Anything on the lab LAN can capture and replay
  it. The switch is the real access boundary until the controller is replaced.
  Rotating the password means changing `PRIVPASSWORD` in the firmware and the
  secret file together.

## Running it

On the lab host, through compose, which is the only way it runs in production:

```
cd infra/door
cp .env.example .env        # CONTROLLER_URL and API_URL
mkdir -p secrets
printf '%s' '<the controller password>' > secrets/controller_password
printf '%s' '<the door token from the public host>' > secrets/door_token
chmod 600 secrets/*
docker compose up -d --build
```

On a laptop, against nothing:

```
CONTROLLER_URL=http://127.0.0.1:9 API_URL=http://127.0.0.1:3000 \
CONTROLLER_PASSWORD=1234 DOOR_TOKEN=dev pnpm --filter @hsl/door dev
```

It answers on `127.0.0.1:8080`:

| Method | Path | Does |
|---|---|---|
| GET | `/healthz` | liveness, no token, says nothing about the building |
| GET | `/status` | reads the controller and returns a `DoorStatus` |
| POST | `/control` | runs one door command |

`/status` and `/control` need the door token as `Authorization: Bearer`. It is
the same value as `secrets/door_token` on the public host.

Rear unlock is refused, by the lab decision of 2018-02-22. The refusal is in
`app.ts`, above the adapter, so it holds whatever hardware is underneath.
`open-rear` still pulses the rear strike.

| Variable | Default | Meaning |
|---|---|---|
| `CONTROLLER_URL` | none | the board on the lab LAN |
| `CONTROLLER_PASSWORD`, `CONTROLLER_PASSWORD_FILE` | none | the privileged password |
| `API_URL` | none | the public members API, reached outbound |
| `DOOR_TOKEN`, `DOOR_TOKEN_FILE` | none | the credential the two hosts share |
| `PORT` | 8080 | the port the local HTTP surface listens on |
| `HOST` | 127.0.0.1 | the interface it binds. Must be `0.0.0.0` inside a container, because a container's own loopback is not reachable from the host, and `infra/door/compose.yaml` sets it. The publish is what restricts it to the lab host |
| `RECONCILE_INTERVAL_SECONDS` | 60 | how often a pass runs |

## Running it against a simulated controller

There is a simulated board in `src/simulator`. It is the same in-memory board
every test here runs against, served over HTTP, so the real adapter and the real
transport can be driven without hardware. It runs from source and is in neither
service image.

```
CONTROLLER_PASSWORD=1234 pnpm --filter @hsl/door simulator
```

Then, in another terminal, the door service pointed at it:

```
CONTROLLER_URL=http://127.0.0.1:8090 CONTROLLER_PASSWORD=1234 \
  API_URL=http://127.0.0.1:3000 DOOR_TOKEN=<the token> \
  pnpm --filter @hsl/door dev
```

The board answers the query protocol on `/`, so anything the service sends can
also be sent by hand:

```
curl 'http://127.0.0.1:8090/?9&e=1234'                     # status
curl 'http://127.0.0.1:8090/?m014&p001&t0001E240&e=1234'   # write a card
curl 'http://127.0.0.1:8090/?a&e=1234'                     # the card table
```

Holding a card to the reader is the one thing the board has no command for, so
the simulator has one of its own. It is under `/simulate` rather than `/`
because it is not part of the protocol:

```
curl -X POST -H 'content-type: application/json' \
  -d '{"cardNumber":"0004B1C7"}' http://127.0.0.1:8090/simulate/present
curl http://127.0.0.1:8090/simulate/state
```

An unknown card comes back `denied` and lands in the log as the two halves the
firmware splits a tag into, which is what the enrolment screen picks up. Write
it to a slot and present it again and it comes back `granted`.

The password is four hex characters because the board reads exactly four. See
`docs/decisions/0014-a-simulated-controller.md` for what this proves and, more
importantly, what it does not.

## Testing it

```
pnpm --filter @hsl/door test
pnpm --filter @hsl/door typecheck
```

Nothing in the suite talks to hardware and nothing assumes hardware is
reachable. Every test runs against `adapters/fake`, an in-memory board that
speaks the same query string protocol through the same codec: the same response
strings, the same 201 slot table, and the same status JSON. The adapter under
test is the real one.

`adapters/conformance.ts` is the suite that says what a controller has to do,
asserted through the `DoorController` interface and nothing else. The fake runs
it in CI. Pointing it at the board in the lab means building the same adapter
over `createHttpTransport` and handing it two slots nobody's card lives in:

```ts
runDoorAdapterConformance('the board in the lab', async () => ({
  adapter: createArduinoController({
    password: process.env.CONTROLLER_PASSWORD ?? '',
    transport: createHttpTransport(process.env.CONTROLLER_URL ?? ''),
  }),
  scratchSlots: [198, 199],
}))
```

The suite leaves the event log alone unless it is told it may clear it, because
on the real board that log is somebody's history.

The tests that matter most, and why:

- Every command in the protocol table round trips as the exact string in
  `docs/legacy-system.md`.
- Reconcile is idempotent. Two passes against the same state produce the same
  result and no second write.
- Reconcile never renumbers. A card at slot 14 and one at slot 199 come back at
  14 and 199.
- A card the controller holds that the database does not know about is reported
  and left alone. Nothing clears a slot this service has not accounted for.
- Slot 200, which production holds one card at, is reported as unusable rather
  than quietly accepted. The firmware writes it and never reads it back.
- Slot allocation returns the lowest free slot under 200 and refuses at 200.
- The adapter never sends a bare `?e=PASS`.
- A five, six or seven character card number is padded to eight, the way
  `Card#upload_to_door` padded it.

## What it depends on

`hono` and `@hono/node-server` for the loopback surface, `zod` for validating
the environment and everything that arrives over the wire, and `@hsl/schema` for
the `DoorController` interface, the card rules and the payloads the two hosts
exchange. All pinned in the workspace catalog. It imports nothing else from this
repository, and nothing imports it.

## What is written down as an assumption

The response formats are no longer among them. They were read out of
`Open_Access_Control_Ethernet.ino` at commit 60e499c and written down in
`docs/legacy-system.md` under "The response formats, read from the firmware",
and both the codec and the simulated board follow that.

What is still unconfirmed against the live board:

- Whether the deployed board is that build at all. The repository has not been
  pushed since 2013 and nothing here records a version read off the device.
- Whether it was built with `DEBUG 2`. If not, `dumpUser` prints `********`
  instead of the tag and no readback is possible.
- The case the controller stores a tag in. Reconcile compares tags case
  insensitively so it cannot rewrite all 64 cards on every pass.
- Whether the permission byte decides anything at the reader, which only the
  simulator has an opinion about, in `simulator/present.ts`.

`HANDOFF.md` section 6 carries these with the command that settles each.

The three paths this service calls on the members API are named in `link.ts`.
