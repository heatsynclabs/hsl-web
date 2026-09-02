# Glossary

The words this codebase uses, and what they mean at the lab. Code uses these
exactly. Rule 7 in `CONTRIBUTING.md` forbids abbreviations that are not here.

## People

**Member** A person with an account. Every signed-in user is a member. The
member row is the user row; there is no separate profile table.

**Member level** The dues tier a member pays. Carries both a role meaning and a
dollar meaning in the legacy database, which is why it is imported as-is rather
than split.

**Oriented** A member who has completed new member orientation, recorded as the
date it happened. Orientation is what unlocks reading other members in the legacy
system.

**Admin** A member who can change other members, cards and certifications. A
single boolean. Every privileged action an admin takes is written to the audit
log.

**Instructor** A member who can grant and revoke certifications.

**Accountant** A member who can record dues payments.

## Access

**Card** A physical RFID token. The lab uses Wiegand-26 readers, so a card
number is a hex string matched on the reader as `parseInt(number, 16) % 32767`.

**Card slot** The position a card occupies in the door controller's EEPROM table,
0 through 199. The legacy `cards.id` is the slot, and the import preserves it
exactly. Renumbering a slot silently maps a member to the wrong door permission.

**Slot ceiling** 200. The Open_Access_Control firmware stores its card table in
EEPROM at five bytes per entry, and that is how many fit.

**Card access** Whether a member may control the doors remotely. In the legacy
system this is derived from holding a card with permission bit 1. Here it is a
plain boolean on the member that an admin sets.

**Certification** A record that a member has been trained on a tool. Granted by
an instructor or an admin, and named by a slug the interlocks can ask about.

**Waiver** The liability release a member signs before using the space.

## The door

**Controller** The Arduino board on the lab LAN that reads the card readers,
drives the strikes and holds the card table. It speaks plain HTTP with the
privileged password in the query string, and it is reachable only from inside
the lab.

**Adapter** The one abstraction in the door service. A `DoorController`
implementation translates the stable door service API into whatever hardware the
lab owns. Today that is the Arduino. Swapping hardware means a new adapter file
and nothing above it changing.

**Privileged mode** The state the controller enters after `?e=PASS`. It leaves
on `?e=0000` and after a chained command.

**Strike** The electric lock on a door. Opening pulses it. Unlocking holds it.

**Front door, rear door** The two doors. Rear unlock is refused by the
application on purpose, by a lab decision from 2018. The refusal lives above the
adapter so it holds no matter what hardware is underneath.

**Reconcile** Rewriting the controller's card table from the database so the two
agree. Runs on a timer and is safe to run twice.

**space_api** The public JSON endpoint the lab website and the ESP8266 status
LED both read to show whether the space is open. Its URL and payload cannot
change.

## The system

**Audit log** The append-only record of privileged changes: who did what to whom
and when. Nothing deletes from it.

**Import** The one-time script that copies the legacy Rails database into this
schema, keeping bcrypt password hashes so nobody resets a password and keeping
card slots so nobody loses door access.

**GANTRY** The HeatSync design system. Tokens, grounds, marks and the type scale
live in `packages/ui`.

**Ground** A GANTRY surface. Setting `data-ground` on an element remaps the
colour tokens for it and everything inside, so a hazard band inside a paper page
still resolves legible text.
