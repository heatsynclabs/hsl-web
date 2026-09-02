# Attributions

What this repository borrowed, and from whom. Section 9 of `CONTRIBUTING.md`
requires an entry for every design, algorithm, schema or piece of code taken
from somewhere else, and for every dependency.

This file is added alongside the legacy import and covers what that work
borrowed. The dependency list and the entries for the door service, the design
tokens and the API are still to be filled in by the changes that introduce them.

## Borrowed patterns

### seedfromold.js

- Project: `temporary-hsl-infra/members_api`
- Holder: Iced Development, LLC, 2019
- License: Apache License 2.0
- Used by: `tools/import/legacy.ts`

The shape of the read is the same: pull the six tables the new system needs,
key everything by the legacy user id, and write the new rows in the order the
foreign keys allow. The field lists that told us `card_permissions` becomes
`permissions` and `contracts.document_file_name` is the pointer to the signed
document came from that file.

Two things in it are not reproduced. It passes async callbacks to `lodash`
`forEach`, which never awaits them, so the process can exit with the writes
still in flight. And it reads `payments.payment_date`, a column the Rails schema
does not have; the column is `date`. Every write in `tools/import/load.ts` is
awaited in order, and the column names were read from `db/schema.rb` rather than
from the earlier script.

### The Rails members application

- Project: `heatsynclabs/Open-Source-Access-Control-Web-Interface`
- License: see `license.md` in that repository
- Used by: `tools/import/`, `packages/schema`

The legacy schema, at migration version 20141120200638, is the source of every
column name the import reads. Two behaviours are reimplemented rather than
copied:

- `Card#upload_to_door` pads a card number with `rjust(8, '0')` before writing
  it to the controller. `canonicalCardNumber` in `tools/import/transform.ts`
  pads the same way, so a short legacy number lands on the same slot value it
  always did.
- `User#card_access_enabled` is true when the member holds at least one card
  with `card_permissions` of exactly 1. `membersWithCardAccess` follows it
  exactly, including treating the one card carrying 255 as granting nothing.

### The access control firmware

- Project: `heatsynclabs/Open_Access_Control_Ethernet`
- Used by: `packages/schema/src/door.ts`, `tools/import/preflight.ts`

`EEPROM_FIRSTUSER`, `EEPROM_LASTUSER` and `NUMUSERS` are where the slot ceiling
of 200 comes from, and the loop bound in `checkUser` is why 199 is the last slot
the reader can see. Both numbers are named in the code that uses them.

## Dependencies

The one version of each shared dependency is declared in the `catalog:` block of
`pnpm-workspace.yaml`. The legacy import uses one of them:

| Package | Version | License | Used for |
|---|---|---|---|
| `pg` | 8.23.0 | MIT | both database connections in `tools/import` |
