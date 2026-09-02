# The legacy system, verified

Everything here was read from the production dump
`members-20260901T014808Z.dump` or from the Rails source in
`heatsynclabs/Open-Source-Access-Control-Web-Interface`, on 2026-09-01. Where an
earlier document disagreed, the disagreement is called out.

The dump restored into a throwaway Postgres 9.6 container with `pg_restore` exit
code 0 and no errors, which satisfies the first gate in `CONTRIBUTING.md`
section 13.

## The host

| Fact | Value | Source |
|---|---|---|
| Operating system | CentOS 6.8, kernel 2.6.32, i386 | dump manifest |
| Postgres | 8.4.20, 32-bit | dump manifest |
| Hostname | hsl-web.hsl.dn42 | dump manifest |

The infrastructure audit assumed Postgres 9.x. It is 8.4.20, which reached end of
life in July 2014. This matters for the import script: 8.4 predates
`jsonb`, `LATERAL`, and ordered-set aggregates, so anything read out of the
legacy database uses plain SQL.

## Row counts

| Table | Rows |
|---|---|
| door_logs | 2,868,091 |
| mac_logs | 191,967 |
| paypal_csvs | 11,825 |
| payments | 8,291 |
| macs | 4,277 |
| users | 1,061 |
| user_certifications | 415 |
| contracts | 318 |
| resources | 165 |
| ipns | 103 |
| cards | 64 |
| toolshare_users | 27 |
| resource_categories | 27 |
| certifications | 10 |
| settings | 6 |

The system that has to move is small. Sixty-four cards and about a thousand
member rows. The two multi-million row tables are append-only logs.

## Passwords

| Prefix | Count |
|---|---|
| `$2a$10$` | 1,030 |
| empty string | 31 |

Every real password is bcrypt at cost 10 with the `$2a$` prefix, which is what
Devise wrote and what a standard bcrypt library reads. The hashes import
verbatim and nobody resets a password.

The 31 empty values are accounts that have never had a password set. They cannot
sign in today and they will not be able to sign in after the import. The import
creates the member row without a credential, and those people use the password
reset flow. This is a behaviour change from nothing, because signing in was
already impossible for them.

## Emails

No null emails, no blank emails, and no duplicates under `lower(email)`, across
all 1,061 rows.

The architecture plan said duplicate emails would need resolving with the old
merge tool before importing. They do not. The unique index on `users.email` has
held.

## Cards and slots

| Fact | Value |
|---|---|
| Cards | 64 |
| Slot range | 14 to 200 |
| Cards above slot 199 | 1 |
| Orphan cards (no matching user) | 0 |
| `card_permissions = 1` | 63 |
| `card_permissions = 255` | 1 |
| Distinct members holding a permission-1 card | 63 |

`cards.id` is the EEPROM slot on the controller, and the firmware indexes slots
0 through 199. One card sits at slot 200, which is outside that range. Either it
was never written to the controller or it silently overwrote something. Confirm
against the live controller with `?a` before the import, and do not renumber it
to fix it: renumbering is what breaks door access.

Card numbers are stored as hex strings of varying length. Six are five
characters, seventeen are six, and forty-one are seven. The controller wants
eight, so `Card#upload_to_door` zero-pads with `card_number.rjust(8, '0')`. Any
replacement must pad the same way or every short card number maps to a different
slot value on the device.

Card access in the legacy system is not a column. It is
`User#card_access_enabled`, which is true when the member holds at least one card
with `card_permissions = 1`. That is 63 members.

## Member levels

| `member_level` | Members |
|---|---|
| 0 | 320 |
| 1 | 36 |
| 10 | 129 |
| 25 | 286 |
| 50 | 243 |
| 100 | 20 |
| null | 27 |

The most common recorded payment amounts are 50.00 (4,515 payments) and 25
(3,222), then 100 (217), 75, 35, and 60. The dues tiers in use are 25, 50 and
100 dollars. The 20, 35 and 80 figures quoted in the infrastructure audit do not
match the data.

`member_level` carries both a role meaning and a dollar meaning, which is why
the import copies it rather than splitting it.

## Certifications

Ten rows, and they are the tool list the interlocks will ask about:

| Slug | Name |
|---|---|
| laser | Laser Cutter |
| cncmill | Mill (CNC) |
| bigmill | Mill (Big) |
| minimill | Mill (Mini) |
| minilathe | Lathe (mini) |
| biglathe | Lathe (Big) |
| migwelder | Welder (MIG) |
| tigwelder | Welder (TIG) |
| tablesaw | Table Saw |
| plasmacutter | Plasma Cutter |

## The public status endpoint

`settings.space_api_json_template` holds a SpaceAPI 0.12 document as a YAML
string. `SpaceApiController#index` parses it, adds two keys, and renders it:

```ruby
@json["open"] = door_status[:unlocked]

if    door_status[:unlocked]        then @json["status"] = "doors_open=both"
elsif !door_status[:door_1_locked]  then @json["status"] = "doors_open=door1"
elsif !door_status[:door_2_locked]  then @json["status"] = "doors_open=door2"
else                                     @json["status"] = "doors_open=none"
end
```

`DoorLog.show_status` derives the booleans from the two most recent `door_logs`
rows whose key is `door_1_locked` or `door_2_locked`, where data 0 means
unlocked and anything else means locked. Unlocked is true when either door is
unlocked.

Two things in that derivation are worth knowing before reimplementing it. The
query takes the two newest rows across both keys and then filters by key, so if
both newest rows happen to share a key, the other door's status comes back nil
and nil is treated as unlocked. And the first branch reports `doors_open=both`
whenever either door is open, not only when both are.

The replacement serves the same payload from the same URL. Parity is proven byte
for byte on a test hostname before the route moves.

## The door wire protocol, as Rails drives it

Read from `app/models/door_log.rb` and `app/models/card.rb`.

Commands are separate requests. Rails logs in, sends one command, then logs out:

```
GET ?e=PASS      login, response is scanned for the substring "ok"
GET ?<param>     the command
GET ?e=0000      logout
```

Card writes are different. They chain the login onto the command in a single
URL, because the controller logs itself out after a chained command:

```
GET ?m<slot:3>&p<permissions:3>&t<number:8>&e=PASS
```

Success is the substring `cur` appearing in the response.

Command parameters, from `DoorLog.parse_command`:

| Command | Parameter |
|---|---|
| open-front | `o1` |
| open-rear | `o2` |
| unlock | `u` |
| unlock-front | `u=1` |
| unlock-rear | `u=2` |
| lock | `l` |
| lock-front | `l=1` |
| lock-rear | `l=2` |
| arm | `2` |
| disarm | `1` |
| anything else | `9`, which is status and does nothing |

`unlock-rear` is refused by the controller action before it reaches the device,
by a lab decision recorded as HYH 2018-02-22. The refusal is in the application,
not the firmware, so it has to be reimplemented above the adapter.

Status is `?9`, returning
`{"armed":255,"activated":255,"alarm_3":1,"alarm_2":1,"door_1_locked":1,"door_2_locked":1}`.
Rails writes every key of that object into `door_logs` as its own row, which is
where the 2.8 million rows came from.

The event log is `?z`, parsed as `key: value` lines, then cleared with `?y`. The
legend is G granted, R read, D denied, in either case.

## The firmware, read directly

From `heatsynclabs/Open_Access_Control_Ethernet`,
`Open_Access_Control_Ethernet.ino`. These are the numbers the door service has to
respect, and two of them differ from what the audit assumed.

```c
#define PRIVPASSWORD 0x1234                              // line 112
#define DOORDELAY 5000                                   // line 121
#define EEPROM_FIRSTUSER 24                              // line 130
#define EEPROM_LASTUSER 1024                             // line 131
#define NUMUSERS ((EEPROM_LASTUSER - EEPROM_FIRSTUSER)/5)  // line 132, 200
```

Each card occupies five bytes: four for the tag number, one for the permission
mask. Slot `n` lives at `24 + n * 5`.

### Slot 200 is writable and unreadable

`addUser` refuses a slot only when `userNum > NUMUSERS`, so it accepts 0 through
200 inclusive, which is 201 slots in a region sized for 200. Slot 200 writes to
byte offsets 1024 through 1028.

`checkUser` scans `for(int i = EEPROM_FIRSTUSER; i <= (EEPROM_LASTUSER - 5); i += 5)`,
so the last offset it reads is 1019, which is slot 199. Slot 200 is never read.

A card written to slot 200 therefore does not open the door, and on an ATmega328
its five bytes land past the end of a 1024 byte EEPROM, where the address wraps
onto `EEPROM_ALARM` and `EEPROM_ALARMARMED` at offsets 0 and 1.

The production database has exactly one card at slot 200. It has permission 1,
so the members database believes that member has door access. The controller
does not. Confirm against the live device with `?a`, move the card to a free slot
below 200, and treat 0 through 199 as the usable range everywhere in the new
system.

### The 32767 divisor is not card matching

The infrastructure audit says card numbers are matched at the reader as
`card_number.to_i(16) % 32767`. They are not. `divisor` is declared once at line
266 and used only inside `addToLog`, which stores 16 bit values and so splits a
32 bit tag across two entries as `LongInfo % divisor` and `LongInfo / divisor`.

`checkUser` compares the full 32 bit tag number for equality. Card matching is
exact. The divisor is how you reconstruct a card number when reading the event
log, and nowhere else. Anything that applies the modulo before comparing will
match the wrong card.

## Authorization, as it exists

From `app/models/ability.rb`. Grants are additive and the flags are independent,
not a ladder.

| Who | Can |
|---|---|
| Anonymous | read and scan MACs, read resources and categories |
| Any signed-in member | own cards, own payments, own certifications, own user row, send email |
| Holds a permission-1 card | control doors remotely, authorize a card for an interlock |
| `instructor` | manage certifications, read non-hidden members, manage the certifications they created |
| `orientation` set | read non-hidden members and reports, create and edit resources |
| `accountant` | manage payments, IPN and PayPal CSV |
| `admin` | everything |

Destroy is blocked globally for certifications, MACs, MAC logs and door logs,
including for admins. Those tables are append-only by design and the replacement
keeps that.

## Known defects carried by the old system

These are not reimplemented.

- `attr_accessible` on the user model whitelists `accountant`, `member_level`,
  `waiver`, `orientation` and `hidden`, and the profile edit accepts them, so a
  member editing their own profile can set those on themselves.
- The door password is four hex digits, sent in a query string over plain HTTP,
  and reused as the session. Anything on the lab LAN can capture and replay it.
  The switch is the real access boundary until the controller is replaced.
- No foreign key constraints exist anywhere in the database.
- Ruby 1.9.3 and Rails 3.2.8 stopped receiving security patches around 2015.
