# 0010. What the import carries and what it leaves behind

Date: 2026-09-11
Status: accepted

## Context

The legacy database holds fifteen tables and about three million rows, of which
the system that has to move is roughly ten thousand. Everything counted here is
from the production dump, read on 2026-09-01, and recorded in
`docs/legacy-system.md`.

## Alternatives

| Option | Why not |
| --- | --- |
| Move everything | Six of the tables have no consumer in the new system, and two of them are multi-million row logs of a thing this schema deliberately does not record. |
| Move nothing and start fresh | A thousand people reset their password, sixty four cards get reissued, and eight thousand payment records stop being answerable. |
| Move it in two passes, people first | The card slots have to arrive with the cards, and the cards have to arrive with the people. One transaction is simpler than two states. |

## Decision

Six tables move.

| Legacy table | Rows | Destination |
| --- | --- | --- |
| `users` | 1,061 | `members`, hash verbatim |
| `cards` | 64 | `credentials`, plus one `door_placements` row each |
| `certifications` | 10 | `certifications` |
| `user_certifications` | 415 | `member_certifications`, with grantor and date |
| `payments` | 8,291 | `payments` |
| `contracts` | 318 | `waivers`, as pointers |

Left behind, with the reason: `door_logs` (2,868,091 rows, three record shapes
in one table, mostly poll snapshots of a status this schema stores as state);
`macs` and `mac_logs` (network presence tracking nothing asks for); `resources`
and `resource_categories` (equipment inventory, a separate concern);
`ipns` and `paypal_csvs` (raw reconciliation payloads with nothing to reconcile
against); `toolshare_users` (a second, unrelated user table); `settings` (five
are page copy, the sixth is now `api/space_api.template.json`).

The old database stays restorable and read-only for a year. A report that needs
the old door logs is a one-off query against the archive, not a table here.

Legacy `cards.id` is an EEPROM slot and cannot be regenerated: renumbering is
what breaks door access. It is carried into `door_placements`, not into
`credentials`, and the function that builds that JSON lives in
`door/src/adapters/openaccess.ts` rather than with the import, so the only code
that knows the Arduino's placement shape stays on the adapter's side of the line
even during migration.

## Consequence

Easy: nobody resets a password, nobody's card id changes, and the first
reconcile pass is close to a no-op because the placements already describe what
is on the device.

Hard: the one legacy card at slot 200 has silently never worked, because the
firmware writes that slot and never reads it. It imports like any other, and the
first pass refuses it, says why, allocates a free slot below the limit and
writes the card properly. That member's card starts working and the door events
say when.

Flip condition: somebody finds a consumer for one of the left-behind tables,
which is a second import script and not a change to this one.
