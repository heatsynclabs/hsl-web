# Glossary

The words this codebase uses, and what they mean at the lab. Code uses these
exactly. Rule 7 in `CONTRIBUTING.md` forbids abbreviations that are not here.

## People

**Member** A person with an account. Every signed-in user is a member. The
member row is the user row; there is no separate profile table.

**Visible** Whether a member has asked for their email address or their phone
number to appear in the directory. Two booleans that came across from the legacy
database, where members set them. Off is the default and off is what most rows
carry.

**Member level** The dues tier a member pays. Carries both a role meaning and a
dollar meaning in the legacy database, which is why it is imported as it stands
rather than split.

**Oriented** A member who has completed new member orientation, recorded as the
date it happened in `oriented_on`. Orientation is what opens the member
directory.

**Admin** A member who can change other members, cards and certifications. Every
privileged action an admin takes is written to the audit log in the same
transaction as the change.

**Instructor** A member who can grant and revoke certifications.

**Accountant** A member who can record dues payments.

**Status** `active`, `lapsed` or `suspended`. Every guard requires `active`, so
a member who is not active can sign in and is refused everywhere with a message
that says so.

## Access

**Card** A physical RFID token. The lab uses Wiegand-26 readers. The API stores
the card id as text with no format rule at all; the adapter canonicalises it to
eight uppercase hex characters, which is the width the controller writes. The
reader matches the full 32 bit value exactly. The `% 32767` figure that appears
in older notes is a log encoding, not card matching, and applying it would match
the wrong card.

**Card slot** The position a card occupies in the door controller's EEPROM
table, 0 through 199. The legacy `cards.id` is the slot, and the import
preserves it. Renumbering a slot silently maps a member to the wrong door
permission.

**Placement** Where a card sits on one particular controller. Written by the
adapter, stored by the API, handed back to the adapter, and never opened by
anything in between. On the Arduino it is `{ slot, mask, tag }`. On a cloud
controller it might be `{ remoteId }`. On a reader where the server decides, it
is null.

**Card access** Whether a member may hold a card that opens a door, and control
the doors remotely. A boolean an admin sets. In the legacy system it is derived
from holding a card with permission bit 1, and the import carries that
derivation across once.

**Certification** A record that a member has been trained on a tool. Granted by
an instructor or an admin, and named by a slug the interlocks can ask about.

**Waiver** The liability release a member signs before using the space. The
database holds a pointer, not a copy.

## The door

**Controller** The hardware on the lab network that reads the card readers,
drives the strikes and holds the card table. Today that is an Arduino running
Open_Access_Control_Ethernet, which speaks plain HTTP with a four hex character
password in the query string, and is reachable only from inside the lab.

**Adapter** The one abstraction in the door service. An implementation of
`DoorAdapter` translates a stable interface into whatever hardware the lab owns.
Swapping hardware means a new adapter file and nothing above it changing.

**Privileged mode** The state the controller enters after `?e=PASS`. It leaves
on `?e=0000` and after a chained command, which is why every command this
service sends is chained.

**Strike** The electric lock on a door. Opening pulses it. Unlocking holds it.

**Front door, rear door** The two doors. `DOOR_ORDER` says which one the
controller calls door 1. Rear unlock is refused by the API on purpose, by a lab
decision from 2018. The refusal lives above the adapter so it holds no matter
what hardware is underneath.

**Capability** Something a controller says it can do: open, lock, unlock, alarm.
Reported with every state update, and the API refuses a command the controller
did not declare rather than queueing one that can never run.

**Pass** One run of `uploadCards`. A pass against a controller that already
agrees with the database writes nothing, which is what makes the loop safe on a
timer.

**Fault** A door event the adapter emits when it could not do something, with
the reason. A card that could not be placed, a slot the device refused, a clear
that was withheld.

**Presented** A door event for a card the reader saw that this system does not
issue. Holding an unissued card to a reader is how a card gets enrolled: it
appears as a row an admin can hand to somebody.

**space_api** The public JSON endpoint the lab website and the ESP8266 status
LED both read to show whether the space is open. Its URL and payload cannot
change.

## The system

**Audit log** The append-only record of privileged changes: who did what to whom
and when. Nothing updates it and nothing deletes from it, enforced by a trigger.

**Door events** The append-only record of what happened at the building. Kept
two years. Status is not an event, so this table grows with building activity
rather than with poll frequency.

**Guard** A middleware naming who may call a route. The name in
`api/src/index.ts` is the complete statement of the rule.

**Import** The one-time script that copies the legacy Rails database into this
schema, keeping bcrypt password hashes so nobody resets a password and keeping
card slots so nobody loses door access.

**Preflight** The part of the import that runs first and refuses to proceed on
any failure. It is safe to run against a restored copy as often as you like.
