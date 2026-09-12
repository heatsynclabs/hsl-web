# 0013. Carry the columns the specification dropped

Date: 2026-09-11
Status: accepted

## Context

The specification's `members` table is a deliberate trim of the legacy `users`
table. Reading the two side by side during an audit, five columns hold data that
exists in production and has nowhere to land:

| Legacy column | Rows it concerns | What is lost |
| --- | --- | --- |
| `orientation` | around 700 | When somebody was oriented, kept as a boolean instead |
| `postal_code` | most members | The member's address |
| `emergency_email` | some members | A way to reach next of kin |
| `email_visible` | all 1,061 | Whether that member wants their address shown |
| `phone_visible` | all 1,061 | The same for their number |

Two more sit outside `members`. `users.waiver` is a second place the legacy
system recorded a signature, and there are 318 contracts against 1,061 users, so
most members who signed have a date there and no document row. And
`contracts.cosigner` is who signed for a member who was under 18.

The visibility flags are the ones that forced this. Without them the directory
either shows every address to every oriented member, which is a preference those
members already expressed and this system would be overriding, or shows none,
which loses a feature the lab has.

## Alternatives

| Option | Why not |
| --- | --- |
| Follow the specification and drop them | The old database stays readable for a year and then does not. "Nobody needs it" is a claim nobody has checked with the lab. |
| Drop the address from the directory instead | Loses a working feature to avoid carrying one boolean, and still leaves the preference unrecorded. |
| A `member_extras` table | A fourteenth table, a join on every read, and nothing gained over five nullable columns. |

## Decision

Five columns on `members`: `oriented_on` replacing `oriented`, `postal_code`,
`emergency_email`, `email_visible`, `phone_visible`. One on `waivers`:
`cosigner`. The import carries all of them, and also writes a waiver row from
`users.waiver` for any member who signed without a contract row.

The directory shows an address or a number only where its member turned the
field on. A member sets both on themselves through `PATCH /api/me`, and nobody
else can.

Still thirteen tables. Still no join added to any read.

## Consequence

Easy: nothing a member told the old system is thrown away by the move, and the
directory keeps working the way it did.

Hard: six more columns than the specification's schema, so a reader comparing
the two finds a difference and has to come here to learn why. `oriented` is no
longer a column, so anything reading it reads `oriented_on is not null` instead,
including the guard.

Flip condition: the lab says it does not want postal codes or emergency email
addresses in this system, which is a data retention decision rather than a
technical one and would be a migration that drops two columns.
