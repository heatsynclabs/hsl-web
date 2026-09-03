# Attributions

Every dependency this repository installs, and every design, schema, protocol or
pattern it borrowed from somebody else's work. Required by section 9 of
`CONTRIBUTING.md`.

Two lists live here. The dependency list is generated from the installed tree.
The borrowed pattern list is written by hand, because a tool cannot see that a
band of numbers in `packages/schema/src/members.ts` came out of a Rails model.

## How the dependency list was made

```
pnpm licenses list --json
```

Run from the repository root on 2026-09-01 against the tree that
`pnpm-lock.yaml` produces. It reported 288 packages. Every one of them declared a
licence, so there is no unknown bucket below. Regenerate this section whenever
the lockfile changes.

## Direct dependencies

The 28 packages named in a `package.json` in this workspace. Versions are the
ones installed, and every shared version is pinned once in the
`pnpm-workspace.yaml` catalog.

| Package | Version | Licence | What it does here |
|---|---|---|---|
| `vue` | 3.5.42 | MIT | The three apps |
| `vue-router` | 5.3.0 | MIT | Routing and the session guard |
| `vue-tsc` | 3.3.11 | MIT | Typecheck across `.vue` files |
| `@vue/test-utils` | 2.5.0 | MIT | Renders components in the test suites |
| `@vue/tsconfig` | 0.9.1 | MIT | Base TypeScript config for the apps |
| `@vitejs/plugin-vue` | 6.0.8 | MIT | Single file component compilation |
| `vite` | 8.2.2 | MIT | Dev server and app builds |
| `vitest` | 4.1.11 | MIT | Test runner everywhere |
| `jsdom` | 30.0.1 | MIT | The DOM the Vue suites click in, per ADR 0011 |
| `esbuild` | 0.28.2 | MIT | Bundles each service to one file for its image, per ADR 0013 |
| `hono` | 4.13.5 | MIT | HTTP framework for the API and the door service |
| `@hono/node-server` | 2.1.1 | MIT | Node adapter under Hono |
| `@hono/zod-validator` | 0.9.1 | MIT | Validates requests against the shared schemas |
| `zod` | 4.5.4 | MIT | Request and response schemas in `packages/schema` |
| `better-auth` | 1.7.2 | MIT | Sessions and accounts inside the API service, and its own client in the members app, per ADR 0012 |
| `bcryptjs` | 3.0.2 | BSD-3-Clause | Verifies the legacy password hashes, per ADR 0004 |
| `drizzle-orm` | 0.45.2 | Apache-2.0 | Tables and queries |
| `drizzle-kit` | 0.31.10 | MIT | Generates the migrations, per ADR 0006 |
| `nodemailer` | 9.1.1 | MIT-0 | Sends the password reset mail from the API |
| `@types/nodemailer` | 8.0.1 | MIT | Types for the mailer |
| `pg` | 8.23.0 | MIT | Postgres driver. Also the only dependency of `tools/import`, which resolves it from `services/api` |
| `@types/pg` | 8.15.6 | MIT | Types for the driver |
| `typescript` | 6.0.3 | Apache-2.0 | The language, pinned by ADR 0009 |
| `typescript-eslint` | 8.69.0 | MIT | TypeScript parser and rules for ESLint |
| `eslint` | 10.9.1 | MIT | The four function ceilings in section 6 |
| `eslint-plugin-vue` | 10.10.0 | MIT | Lints single file components |
| `eslint-plugin-boundaries` | 7.2.0 | MIT | The dependency direction gate in section 5 |
| `@types/node` | 22.20.1 | MIT | Node type definitions |

## The whole installed tree

Direct and transitive together, counted by licence.

| Licence | Packages |
|---|---|
| MIT | 363 |
| Apache-2.0 | 41 |
| ISC | 15 |
| MPL-2.0 | 12 |
| BSD-2-Clause | 11 |
| BSD-3-Clause | 5 |
| BlueOak-1.0.0 | 5 |
| MIT-0 | 3 |
| CC0-1.0 | 1 |
| 0BSD | 1 |

457 distinct packages. All ten licences are permissive. Four carry an obligation
worth naming.

The tree grew by 169 packages when jsdom entered the development install, which
is where most of the new MPL-2.0 and every MIT-0, CC0-1.0 and 0BSD row comes
from. None of them reaches a runtime image or a browser bundle: jsdom is a
devDependency of four packages and the service images carry no `node_modules` at
all.

**Apache-2.0** wants the licence text and any `NOTICE` file preserved in a
distribution. Of the 18 Apache packages, `drizzle-orm` 0.45.2 ships neither a
`LICENSE` nor a `NOTICE` file in its published tarball, and `typescript` 6.0.3
ships `LICENSE.txt` and `ThirdPartyNoticeText.txt`. Nothing in this repository
redistributes either package's source, so the obligation is met by naming them
here. The other Apache packages are ESLint and Vitest internals:
`@drizzle-team/brocli`, `@eslint/config-array`, `@eslint/config-helpers`,
`@eslint/core`, `@eslint/object-schema`, `@eslint/plugin-kit`, `@humanfs/core`,
`@humanfs/node`, `@humanfs/types`, `@humanwhocodes/module-importer`,
`@humanwhocodes/retry`, `@opentelemetry/semantic-conventions`, `detect-libc`,
`eslint-visitor-keys`, `expect-type`, `xml-name-validator`.

**MPL-2.0** is file level copyleft. All twelve packages are `lightningcss` and
its eleven per-platform native binaries, pulled in by Vite as a build time CSS
transformer. Their own source files are neither modified nor redistributed here,
so the copyleft never reaches anything in this repository. If somebody ever
patches a lightningcss source file, that patched file stays MPL-2.0 and has to
be published.

**MIT-0** covers `nodemailer` 9.1.1, which the API uses to send password reset
mail, plus two `@csstools` packages under the CSS tooling. MIT-0 is MIT without
the attribution requirement, so it asks nothing of this repository. It is named
here because the row above says so and a reader should not have to check.

**BSD-3-Clause** covers `bcryptjs` 3.0.2, `esquery` 1.7.0, `source-map` 0.6.1 and
`source-map-js` 1.2.1. The no endorsement clause means the lab does not describe
this system as approved by any of their authors.

**BlueOak-1.0.0** covers `glob` 13.0.6, `lru-cache` 11.5.2, `minimatch` 10.2.6,
`minipass` 7.1.3 and `path-scurry` 2.0.2, all reached through the tooling.

## Borrowed patterns

### heatsynclabs/Open-Source-Access-Control-Web-Interface

The Rails members app this system replaces. Read at commit `41797ad`.

- Licence: Creative Commons Attribution 3.0, from `license.md` in that
  repository. The `README.md` there reads "Copyright Will Bradley, 2012-2024".
- URL: https://github.com/heatsynclabs/Open-Source-Access-Control-Web-Interface
- Upstream of that branch: https://github.com/zyphlar/Open-Source-Access-Control-Web-Interface

What this repository takes from it:

| Taken | Where it lives now | Source in the Rails app |
|---|---|---|
| The members schema: users, cards, certifications, user_certifications, payments, waivers | `packages/schema/src/tables.ts` | `db/schema.rb` |
| The member level bands and their labels | `MEMBER_LEVEL_BANDS` in `packages/schema/src/members.ts` | `app/models/user.rb` |
| Dues are current while the most recent payment is inside a 60 day window | `paymentStatus` in `packages/schema/src/members.ts` | `app/models/user.rb` |
| The door command parameter table: `o1`, `o2`, `u`, `l`, `2`, `1`, `9` | `services/door/src/adapters/openaccess-arduino/wire.ts` | `DoorLog.parse_command` |
| The rear unlock refusal, a lab decision recorded as HYH 2018-02-22 | The control route in `services/api`, above the adapter | The controller action |
| The `space_api.json` payload shape and its status strings | `services/api/src/routes/space-api.ts` | `SpaceApiController#index` |
| Card access derived from a card holding permission bit 1 | `membersWithCardAccess` in `tools/import/transform.ts`, then a plain boolean on the member | `User#card_access_enabled` |
| Padding a card number to eight characters with `rjust(8, '0')` before it reaches the controller | `canonicalCardNumber` in `tools/import/transform.ts` | `Card#upload_to_door` |
| The legacy column names the import reads, at migration version 20141120200638 | `tools/import/legacy.ts` | `db/schema.rb` |
| Reading a door status of 0 as unlocked and anything else as locked | `parseStatus` in `services/door/src/domain/status.ts` | `DoorLog.show_status` |

Every one of these was read from that source rather than remembered, and the
readings are written down in `docs/legacy-system.md` with row counts and line
numbers.

### heatsynclabs/Open_Access_Control_Ethernet

The Arduino firmware on the controller. The door service speaks its wire
protocol and writes into its EEPROM layout. Read at commit `60e499c`, dated
2013-12-02.

- Licence: none found. See the open questions below.
- URL: https://github.com/heatsynclabs/Open_Access_Control_Ethernet
- Branch author, from the file headers: Will Bradley, will@heatsynclabs.org, with
  Short Tie. Upstream: Arclight and Danozano of 23B Shop Hacker Space, at
  http://code.google.com/p/open-access-control/
- Bundled libraries in that tree: `WIEGAND26`, `DS1307`, `PCATTACH`.

What this repository takes from it:

| Taken | Where it lives now | Source in the firmware |
|---|---|---|
| `NUMUSERS` 200, from `(EEPROM_LASTUSER 1024 - EEPROM_FIRSTUSER 24) / 5` | `CARD_SLOT_COUNT` in `packages/schema/src/door.ts` | lines 130 to 132 |
| Slot 199 is the last slot `checkUser` reads, so 200 is writable and unreadable | `LAST_USABLE_CARD_SLOT` in `packages/schema/src/door.ts` | `checkUser` |
| Five bytes per card, slot `n` at byte `24 + n * 5` | The reconcile loop in `services/door/src/domain` | `addUser` |
| The query string protocol, privileged mode on `?e=PASS`, the chained card write | `services/door/src/adapters/openaccess-arduino/wire.ts` | the HTTP handler |
| The event log key legend, and that the 32767 divisor is a log encoding rather than card matching | `packages/schema/src/door.ts`, parsed in `wire.ts` | `addToLog` |
| The `?9` status payload and its snake case keys | `services/door/src/domain/status.ts` | the sketch's HTTP handler |
| The same protocol reimplemented in memory for tests | `services/door/src/adapters/fake/device.ts` | the whole sketch |

The two adapter files carry headers naming the firmware, as section 9 requires.

### The typefaces

Five subset woff2 files, taken from the HeatSync brand pack and self hosted so
no page reaches a font CDN. Each is the upstream project's own release, subset to
latin, not something drawn here.

| Family | Used for | Licence |
|---|---|---|
| Archivo | display and headings | SIL Open Font Licence 1.1 |
| Instrument Sans | body text | SIL Open Font Licence 1.1 |
| IBM Plex Mono | interface labels | SIL Open Font Licence 1.1 |
| JetBrains Mono | code and card numbers | SIL Open Font Licence 1.1 |
| Charis SIL | the wordmark, and nothing else | SIL Open Font Licence 1.1 |

The OFL permits redistribution of the font files with the software, including
subset copies, provided they are not sold on their own and the licence travels
with them. The brand pack these came from carries no licence file of its own,
which is noted in the open questions.

### GANTRY, and the 29 marks

The HeatSync design system. Tokens, grounds, the type scale and the mark
artwork, from `heatsynclabs/new-hsl`, the lab's own website.

- Licence: none declared. See the open questions below.
- URL: https://github.com/heatsynclabs/new-hsl

What this repository takes from it:

| Taken | Where it lives now |
|---|---|
| The GANTRY v2.0 token set, extending the v1.1 tokens shipping in new-hsl | `packages/ui/src/styles/tokens.css` |
| The 29 HeatSync marks, copied unchanged as SVG | `packages/ui/src/marks/` |
| Five subset woff2 faces, copied unchanged from the brand pack | `packages/ui/src/styles/fonts/` |
| The component idiom the fifteen components follow | `packages/ui/src/components/` |

`--g-plate` is not borrowed. The mockups referenced it and no source defined it,
so `packages/ui` defines it per ground and says so in the file.

The marks are HeatSync Labs trademarks as well as artwork. This repository is the
lab's own system, so the use is internal. Anyone forking it should replace the
contents of `packages/ui/src/marks/` rather than ship the lab's identity.

### heatsynclabs/members_api

The Node rewrite of the members API that came before this one. Read at commit
`4373e07`, dated 2023-05-13.

- Licence: Apache-2.0, from the full licence text in `LICENSE.txt` and the
  `"license": "Apache-2.0"` field in `package.json`. That `package.json` names
  the author as Iced Development, LLC. There is no `NOTICE` file in the
  repository.
- URL: https://github.com/heatsynclabs/members_api

`members_api/seedfromold.js` reads the same legacy database, and the import in
`tools/import` follows its shape.

| Taken | Where it lives now | Source |
|---|---|---|
| Read the six tables the new system needs, key everything by the legacy user id, write in the order the foreign keys allow | `tools/import/legacy.ts` and `tools/import/load.ts` | `run()` |
| `card_permissions` becomes `permissions`, `cards.name` becomes the card label | `loadCards` in `tools/import/load.ts` | `cardFields` |
| `contracts.document_file_name` is the pointer to the signed document rather than a copy of it | `loadWaivers` in `tools/import/load.ts` | `contractFields` |
| `user_certifications.created_by` is the grantor and `payments.created_by` the recorder | `loadGrants` and `loadPayments` in `tools/import/load.ts` | `userCertFields`, `paymentFields` |
| Multiply a decimal amount by 100 to store cents | `amountToCents` in `tools/import/transform.ts`, done on the decimal string rather than a float | `up.amount = Math.floor(up.amount * 100)` |

Two things in it are deliberately not reproduced, and both are noted in the
header of `tools/import/load.ts`:

- It passes async callbacks to lodash `forEach`, which never awaits them, so the
  process can exit with the card, certification, payment and contract writes
  still in flight. Every write in `tools/import/load.ts` is awaited in order,
  inside one transaction.
- It reads `payments.payment_date`, which is not a column in the Rails schema.
  The column is `date`. Every column name in `tools/import/legacy.ts` was read
  from `db/schema.rb` rather than from this script.

## Open questions

Section 2 says a fact that cannot be checked gets written down rather than
guessed. Three licence questions are open.

**Open_Access_Control_Ethernet has no licence.** A recursive search of the
checked out tree at commit `60e499c` found no `LICENSE`, `COPYING` or `NOTICE`
file, and no licence statement in any source file. The only related line is in
the sketch header: "Notice: This is free software and is probably buggy." That
is a disclaimer of warranty, not a grant. The upstream Google Code project is
gone, so its terms could not be read either.

- CONFIRM BY: asking Will Bradley, who is a HeatSync member and the branch
  author, to add a licence file to that repository.
- BLAST RADIUS: none today. This repository copies no firmware code. It
  reimplements the wire protocol and the EEPROM arithmetic, which are facts about
  a device rather than expression. It would matter if anything here ever vendored
  the sketch or one of its bundled libraries.

**GANTRY has no declared licence.** `heatsynclabs/new-hsl` carries no licence
file and its `package.json` has no `license` field. The tokens and all 29 marks
in `packages/ui` came from it.

- CONFIRM BY: asking the board or the site maintainer to declare a licence on
  `new-hsl`, and to say separately how the marks may be used, since trademark and
  copyright answer different questions.
- BLAST RADIUS: internal use is not at risk, since both repositories belong to
  the same organisation. An outside fork of this repository has no stated
  permission to ship the marks.

**This repository is MIT.** `LICENSE` holds the text and the root
`package.json` declares `"license": "MIT"`. It carried `"license": "Apache-2.0"`
with no licence file beside it until 2026-09-03, which is what this entry used
to record as an open question.

MIT sits alongside the Creative Commons Attribution 3.0 obligation to the Rails
app, which is compatible in the direction that matters: CC BY 3.0 asks only for
attribution and this file provides it. It is also compatible with every
dependency licence in the table above, all of which are permissive.
