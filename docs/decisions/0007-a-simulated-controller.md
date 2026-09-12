# 0007. A simulated controller, not a mock

Date: 2026-09-11
Status: accepted

## Context

The door service has never spoken to the real hardware. Nobody has been in front
of the controller, and the repository it runs has not been pushed since 2013.
Everything known about its responses was read out of the firmware source.

## Alternatives

| Option | Why not |
| --- | --- |
| An in-process mock of the adapter | Proves that the loop calls a function and nothing about what comes back. Three defects hid behind exactly that in the previous attempt: a card table parsed with a regex matching a format the firmware does not emit, a status document parsed with `JSON.parse` over a body beginning `authok`, and a single-slot read that returned that same `authok`. |
| Test against the real board only | Needs somebody at the lab for every change, and CI cannot run it. |
| Record and replay real responses | Nobody has recorded any. When somebody does, they become the fixtures this simulator is checked against. |

## Decision

`door/src/adapters/fake.ts` is an Open_Access_Control board in memory. Every
literal in it was read out of `Open_Access_Control_Ethernet.ino` on master,
commit 60e499c, with the firmware line number in the comment beside it. The
adapter under test is the real one. `serveFakeDevice` puts the same object on a
socket, so the suite drives the real codec over a real connection.

It models the things that bite: `?a` printing all two hundred slots including
empty ones, a write to slot 200 answering `Bad user number!` between two `cur:`
lines so the success substring is still present, `authok` before every chained
response, forty log slots whether or not they hold anything, CRLF on every line,
and a DEBUG build that prints asterisks where the tag goes.

## Consequence

Easy: the whole door service, including the wire codec and the HTTP transport,
runs in CI with no hardware and in about a third of a second.

Hard, and worth saying out loud every time: the simulator answers the bytes
somebody read out of the firmware, so it agrees with that reading by
construction. It raises confidence in the code and none at all in the reading.
Only a trip to the lab settles the reading, and `HANDOFF.md` section 3 lists
what to check when somebody gets there.

Flip condition: none. When real responses are captured, they replace the
firmware reading as the source and this file is corrected against them.
