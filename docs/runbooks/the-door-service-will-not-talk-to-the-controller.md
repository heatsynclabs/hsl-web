# The door service will not talk to the controller

Symptom: `GET /api/door` says `"stale": true`, or remote control answers 503, or
the door service log has `door_link_down`.

Cards still open the door the whole time this is happening. The card table on
the controller is whatever it last was, and the controller decides on its own.
This is not urgent. Work through it in order.

## 1. Read the last error

```sh
docker compose -f compose.lab.yml logs --tail 20 door
curl -s localhost:9000
```

The health check answers the last error as a sentence. The error messages in
this service say what happened, what the system did and what to do next, so read
it before doing anything else.

## 2. Is it the link to the API, or the link to the controller

`door_link_down` with a message naming the API means the lab's internet is down
or the API is. `door_link_down` with a message naming the controller means the
board.

```sh
curl -sS https://api.heatsynclabs.org/healthz
```

Expect `{"ok":true}`. If that fails, the problem is on the public host and this
runbook is the wrong one.

## 3. Is the board reachable

```sh
curl -sS --max-time 5 "http://<controller>/?9"
```

`?9` is the one command that needs no password. Expect a JSON document with six
keys.

- Connection refused: the board is off, or the address is wrong.
- It hangs: the board took the connection and stopped talking. It is wedged
  rather than absent. Power cycle it.
- HTML that is not JSON: the address is not the controller.

## 4. Is the password right

```sh
curl -sS "http://<controller>/?9&e=1234"
```

Expect `authok` on the first line, then the document. `authfail` means the four
characters are wrong. The value is the four hex characters, not the C literal
`0x1234`, and never `0000`, which is what the chained logout sends.

Five failed logins in five minutes lock privilege mode out for five minutes.
Wait it out rather than trying again.

## 5. Is the card table readable

```sh
curl -sS "http://<controller>/?a&e=1234" | head -5
```

Expect `authok`, then `<pre>`, then `UserNum: Usermask: TagNum:`, then rows of
three tab separated numbers.

If the third column is `********`, the board was built with `DEBUG` below 2 and
its card table cannot be read back. That is not a failure: the door service
detects it, says so once as a fault, and trusts the placements it holds instead.
It does mean a card written outside this system will never be noticed.

## 6. If the card table looks wrong

Do not clear it. The door service refuses to clear more than five cards in one
pass, and refuses entirely if the card list came back empty, so a database
problem cannot empty the board. If a pass is withholding clears, the fault event
says how many, and the question to answer is why the API is answering with fewer
cards than it should.

```sh
docker compose exec -T db psql -U hsl hsl -c \
  "select kind, detail from door_events where kind = 'fault' order by id desc limit 5"
```

## 7. Start it again

```sh
docker compose -f compose.lab.yml restart door
```

The first pass after a restart reports rather than acts, and the tick is five
seconds. Give it fifteen and look at `GET /api/door` again.
