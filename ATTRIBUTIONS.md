# Attributions

What this project borrowed and from whom. Rule 9 in `CONTRIBUTING.md`: if a
design, algorithm, schema or more than a few lines of code came from somewhere
else, it is named here and where the code lives.

Versions and licences read from the npm registry on 2026-09-11.

## Dependencies

### api

| Package | Version | Licence |
| --- | --- | --- |
| `hono` | 4.13.7 | MIT |
| `@hono/node-server` | 2.1.1 | MIT |
| `postgres` | 3.4.9 | Unlicense |
| `jose` | 6.2.12 | MIT |
| `@node-rs/argon2` | 2.2.1 | MIT |
| `bcryptjs` | 3.0.3 | BSD-3-Clause |
| `nodemailer` | 10.0.8 | MIT-0 |

### door

| Package | Version | Licence |
| --- | --- | --- |
| `undici` | 8.10.2 | MIT |

### Development only

| Package | Version | Licence |
| --- | --- | --- |
| `typescript` | 7.0.2 | Apache-2.0 |
| `@types/node` | 24.13.4 | MIT |

### Images

`postgres:17`, `node:24.20-alpine` and `caddy:2`, from Docker Hub.

## HeatSync Labs work this is built on

### Open-Source-Access-Control-Web-Interface

<https://github.com/heatsynclabs/Open-Source-Access-Control-Web-Interface>

The Rails application this replaces. What is taken from it:

- The data model. `members`, `credentials`, `certifications`,
  `member_certifications`, `payments` and `waivers` are its `users`, `cards`,
  `certifications`, `user_certifications`, `payments` and `contracts`, with the
  names changed and the foreign keys added. `scripts/import.ts` carries the
  column mapping, read from `db/schema.rb` at version 20141120200638.
- The door command parameters, from `DoorLog.parse_command`. They are in
  `door/src/adapters/openaccess.ts`.
- The card padding rule, `card_number.rjust(8, '0')`, from
  `Card#upload_to_door`. Same file.
- The status derivation and the `doors_open=` strings, from
  `SpaceApiController#index` and `DoorLog.show_status`, reproduced including
  their defect in `api/src/routes/spaceapi.ts`.
- The authorization model, from `app/models/ability.rb`, which is where the
  roles and the orientation flag come from.
- `api/space_api.template.json` is `settings.space_api_json_template` from the
  production database, unchanged.

The repository carries no licence file. Section 8 of `HANDOFF.md` says what that
means and what the lab should do about it.

### Open_Access_Control_Ethernet

<https://github.com/heatsynclabs/Open_Access_Control_Ethernet>

The firmware on the door controller. Read at commit 60e499c on 2026-09-03.
Everything in `door/src/adapters/openaccess.ts` and `door/src/adapters/fake.ts`
that carries a line number was read out of `Open_Access_Control_Ethernet.ino`:
the EEPROM layout, the slot ceiling, the response literals, the log encoding and
its divisor, the login truncation, and the timing of the blocking commands.

That firmware is itself derived from Arclight Dynamics' Open Access Control. It
carries no licence file either.

## Documents this project was built from

`docs/legacy-system.md` is the verified reading of the production dump
`members-20260901T014808Z.dump` and of the two repositories above. Where an
earlier planning document disagreed with what the data said, the data won, and
the disagreement is recorded there.

`hsl-web-api-spec.md`, revision 3, is the specification this repository
implements. Where the implementation differs from it, section 2 of `HANDOFF.md`
says where and why.
