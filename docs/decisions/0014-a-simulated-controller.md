# 0014. A simulated controller, not a mock and not hardware

Date: 2026-09-03
Status: accepted

## Context

The door service had never spoken to anything over a socket. Every test drove
the adapter through an in-process function, so `createHttpTransport` ran nowhere
and the board's real byte output was never parsed by the real codec.

That gap hid three defects at once, each of which would have fired on the first
day against real hardware: the card table dump was parsed with a regex matching
a format the firmware does not emit, so reconcile would have rewritten all 64
cards every minute forever; the status document was parsed with `JSON.parse`
over a body that begins `authok`, so every poll would have thrown; and reading
one slot took the first line of the response, which is that same `authok`.

None of the tests could see it, because the in-memory board answered a third
dialect that matched neither the firmware nor the parser.

## Alternatives

| Option | Why not |
|---|---|
| Point the tests at the board in the lab | The only thing that settles the format for certain, and it is what section 6 of `HANDOFF.md` still asks for. It needs somebody standing in the building with LAN access, it cannot run in CI, and a test that opens a real door is not a test anybody runs twice. |
| Record real responses and replay them | Would be exact, and needs the same trip to the lab to record them. Worth doing when somebody makes it: a recording would confirm this simulator rather than replace it. |
| Mock the transport | What the suite effectively had. It proves the adapter calls a function and nothing about what comes back. |
| A second program that imitates the board | Two implementations of one protocol, and the one under test is the one nobody runs. |

## Decision

`services/door/src/simulator` serves `adapters/fake/device.ts` over HTTP. The
board is the same object every other test in this service already runs against,
so there is one implementation and a wrong reading of the firmware is wrong in
both places at once rather than hidden in one.

That device was rewritten to emit the firmware's real bytes, read from
`Open_Access_Control_Ethernet.ino` at commit 60e499c and written down in
`docs/legacy-system.md` under "The response formats, read from the firmware".

The simulator carries one thing the board has no command for: `POST
/simulate/present` puts a card read in the log, because on real hardware the
only way to do that is to hold a card to a reader. It is namespaced away from
`/` so nobody mistakes it for the protocol.

It runs from source and is bundled into neither service image.

## Consequence

Easy: the whole enrolment loop can be walked on a laptop, and the reconcile
loop's idempotency is now proven over a socket rather than in process. A
volunteer can develop against a door without a door.

Hard, and this is the part to keep saying out loud: the simulator answers the
bytes this repository read out of the firmware, so it agrees with that reading
by construction. It raises confidence in our code and none at all in our
reading. Every unknown in `HANDOFF.md` section 6 stays open, including whether
the deployed board is even this build.

Flip condition: somebody records real responses from the board in the lab. Then
the recording becomes the fixture, and this becomes the thing that is checked
against it.
