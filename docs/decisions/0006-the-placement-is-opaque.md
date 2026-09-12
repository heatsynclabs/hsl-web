# 0006. The placement is opaque to the API

Date: 2026-09-11
Status: accepted

## Context

The adapter has to remember one thing across a restart: where each card landed
on this particular device. On the Arduino that is an EEPROM slot, a permission
byte and a padded tag. On a cloud controller it would be a remote id. On a
reader where the server decides, nothing.

The lab host should store nothing, so that reimaging it is five environment
variables and no restore. That means the API carries the value.

## Alternatives

| Option | Why not |
| --- | --- |
| Columns on `credentials` for slot and mask | The API then knows what a slot is, and the next controller either reuses columns that mean something else or gets a migration. This is the mistake the legacy schema made. |
| State on the lab host | A file the door service owns, which is then a thing to back up, a thing to restore, and a thing that disagrees with the database after a reimage. |
| Derive the slot each pass | Deterministic allocation across restarts requires the device to be readable, and one build of the firmware is not. |

## Decision

`door_placements.placement` is `jsonb`, written by the adapter, handed back to
the adapter, and opaque in between.

> Nothing in the API reads inside a placement. No query filters on it, no
> contract describes its contents, no index touches its keys, no response
> renders it as anything but opaque JSON.

This is the one rule in the system that must never bend. It has a concrete
enforcement point: `api/src/db.ts` configures the column name transform and
deliberately not `postgres.camel`, whose value transform rewrites the keys
inside every jsonb value. There is a test that puts a placement with snake case
keys in and asserts the same object comes back.

## Consequence

Easy: every hardware fact lives in one file, while the durable state lives in
the one database that is already backed up. Two controllers can hold the same
card at once, with two placement rows, which is what makes a week of running
both possible.

Hard: nothing can report on placements. An admin screen can say a placement
exists for a controller and not what it is, and a question like "which slot is
this card in" is answered by asking the door service, not the database.

Flip condition: none that anybody has thought of. Something that looks like a
reason to read a placement is a reason to add a method to the adapter.
