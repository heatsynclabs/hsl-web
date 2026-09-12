# 0009. The card list version is a digest, not a counter

Date: 2026-09-11
Status: accepted

## Context

The door service fetches the card list only when it has changed, so an idle lab
costs one small request every five seconds. Something has to tell it that the
list moved.

## Alternatives

| Option | Why not |
| --- | --- |
| A counter bumped by every route that changes the list | Six routes have to remember, and a seventh written next year has to remember too. The failure is silent and the symptom is a card that does not work. |
| A trigger maintaining the counter | Correct, and it moves the rule into the database where the next reader of `members.door_access` will not look for it. |
| `max(updated_at)` across the tables involved | Card access lives on `members`, so every profile edit in the building would move it. |
| A sync endpoint an admin presses | What the legacy system had. An admin had to remember to press it. |

## Decision

The version is a SHA-256 digest of the card list the API would answer with,
truncated to sixteen characters, computed on each request. Sixty four rows, one
query, no state.

The placement is deliberately not in the digest. The adapter writes placements
itself, so including them would make every pass change the version it had just
answered, and the loop would fetch forever.

## Consequence

Easy: the version cannot be wrong, because it is a function of the answer. A
route added next year gets it for free.

Hard: one extra query per tick, and the digest changes if the card ordering ever
changes, which would cause one unnecessary fetch and nothing worse.

Flip condition: the card list reaches a size where hashing it per tick is worth
measuring. At sixty four rows it is not.
