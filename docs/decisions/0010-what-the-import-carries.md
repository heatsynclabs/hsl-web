# 0010. What the import carries, and what it leaves behind

Date: 2026-09-01
Status: accepted

## Context

The legacy database has fifteen tables and about 3.1 million rows, of which
2.87 million are door logs. Carrying all of it means reimplementing MAC presence
tracking, an equipment inventory, and two PayPal reconciliation formats that
nobody asked for.

## Decision

Carried, with the reason:

| Table | Rows | Why |
|---|---|---|
| `users` | 1,061 | The membership. |
| `cards` | 64 | Slot ids are EEPROM addresses and cannot be regenerated. |
| `certifications` | 10 | The tool list the interlocks ask about. |
| `user_certifications` | 415 | The mockup shows a granted date and a grantor. Both are in these rows. |
| `payments` | 8,291 | The membership card shows payment status, which is derived from the most recent payment. |
| `contracts` | 318 | Signed liability releases. Legal records, carried as a pointer to the stored document rather than a copy. |

Left behind, with the reason:

| Table | Rows | Why not |
|---|---|---|
| `door_logs` | 2,868,091 | Three record shapes in one table, most of it status snapshots written once per poll. The new system records events in its own shape. Keep the old database readable for a period rather than importing this. |
| `macs`, `mac_logs` | 196,244 | Network presence tracking. No screen in the mockups shows it and the endpoints were anonymous by design. |
| `resources`, `resource_categories` | 192 | Equipment inventory. A separate concern that belongs in its own system or the wiki. |
| `ipns`, `paypal_csvs` | 11,928 | Raw PayPal reconciliation payloads. Signup records intent and dues arrive offline, so there is nothing here to reconcile against. |
| `toolshare_users` | 27 | A second, unrelated user table that was never the members login. |
| `settings` | 6 | Five are page copy. The sixth is the space_api template, which is copied into the door service as a file rather than a database row. |

## Consequence

Easy: the import is one script over six tables and it finishes in seconds.

Hard: door history before cutover lives only in the old database. The runbook
says to keep it restorable and read only for a year rather than deleting it.

Flip condition: somebody asks for a report that needs the old door logs, at which
point they are a one-off query against the archived dump, not a table in this
system.
