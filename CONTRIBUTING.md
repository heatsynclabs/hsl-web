<!-- voice-check: reference -->

# Working rules

This repository runs the members database and unlocks a building for a
501(c)(3). Two previous rewrites stalled on the members side, and a third grew
an admin app, a members app, a signup app, two shared packages and an ORM before
anybody had signed in. These rules exist to keep this one small enough to finish
and plain enough to maintain.

Short version: keep it simple, prove it works, write it so a volunteer can fix
it at 2am.

## 1. Attribution

Never name a language model as an author, co-author, contributor or reviewer.
Not in commit messages, trailers, pull request bodies, changelogs, comments or
package metadata. The person who ran the session is the author.

Banned anywhere in a commit message or pull request body:

```
Co-Authored-By: Claude
Generated with Claude Code
Claude-Session:
Assisted-By:
AI-Generated:
```

*Gate:* `.githooks/commit-msg`, enabled with `make hooks`, and CI over every
commit in a pull request. CI is the half that holds: a local hook runs only for
somebody who enabled it and did not pass `--no-verify`.

## 2. Never assume

Every factual claim about this codebase or the systems it talks to traces to
something checked in this session. Read version numbers, environment variable
names, config keys, API paths and column names from the source, never from
memory. "Should work" and "typically" are not evidence.

When a fact is missing and cannot be checked, write the gap down where the code
that depends on it lives:

```
ASSUMPTION: production Postgres is 9.6, not 9.x generally.
CONFIRM BY: psql -c 'select version()' on the members host.
BLAST RADIUS: the import script's use of generated columns.
```

The legacy production database has no foreign key constraints anywhere, so any
integer column named `*_id` may point at a row that does not exist. Every read
of imported data tolerates nothing coming back.

## 3. Check the work

Nothing is done until it has been run.

- Run the thing. An API change is verified by calling the endpoint, not by
  reading the diff.
- When you claim a test passes, paste the output. When one fails, say so and
  show it.
- Migrations run against a real Postgres before merge. CI builds the schema from
  nothing every time, so a migration that only works against an already migrated
  database fails there.
- Anything touching the door runs against the simulated controller before it
  goes near hardware.
- Before calling a task complete, re-read the request and list what you did not
  do.

## 4. Tests that mean something

Write the failing test first for authorization rules, the door protocol, the
legacy import, and anything touching money or access.

- Assert on behaviour a person cares about. "A member cannot give themselves the
  admin role" is a test. "The repository method was called once" is not.
- Every authorization rule gets a test per role, including anonymous, and
  including the case that must be refused. A rule without a refusal test is
  untested.
- `uploadCards` gets a test proving it is idempotent: run it twice against the
  same state, and the second pass writes nothing.
- Anything with a slot number gets a test proving slot values survive the
  import. A slot is an EEPROM address. Renumbering silently maps every member to
  the wrong door permission.
- The placement gets a test proving it comes back byte for byte. Rule One of the
  README is the one rule that must never bend, and a JSON transform that tidies
  keys breaks it quietly.
- Test the boundary, not the mock. A real Postgres beats a stubbed query
  builder. A simulated controller speaking the real wire protocol beats a mocked
  client object.

The runner is `node --test` and the assertions are `node:assert`. There is no
test framework, because the two things a framework adds here are a watcher and a
mocking library, and the second one is the thing rule 4 exists to prevent.

Coverage is not collected. If somebody wants it, publish the report as a CI
artifact and do not gate on a threshold: a threshold turns coverage into the
goal, and then somebody writes a test that executes a module and asserts
nothing.

## 5. Separation of concerns

There are two processes and one line between them, and that line is HTTP.

```
door/src/adapters/*     the only code that knows what the hardware is
  |                     reaches the rest of the system through door/src/link.ts
  v
api/src/routes/*        the only code that knows what the rules are
  |
  v
migrations/             the only code that knows what the shape is
```

- The API never speaks the door wire protocol and never opens a socket to a
  controller. It hands the door service a card list and takes events back.
- The API never reads inside a placement. No query filters on it, no contract
  describes its contents, no index touches its keys, no response renders it as
  anything but opaque JSON.
- The door service holds the controller password and nothing else does.
- Each business rule lives in exactly one place. A refusal that is a lab
  decision rather than a hardware fact lives above the adapter, so it survives
  the next controller.
- `api/src/index.ts` is the route table and nothing else. A route that is not a
  line in it does not exist.
- One file per controller. Every slot number, mask, pad, literal and quirk of a
  device lives in that one file, including the firmware line number it was read
  from.

*Gate:* review. There is no lint rule for this, and saying there is one when
there is not is worse than saying there is none. The two directories have no
imports between them except one: `scripts/import.ts` reads the Arduino's
placement shape from `door/src/adapters/openaccess.ts`, so that even during
migration the only code that knows what a slot is stays on the adapter's side.

## 6. No monolithic files

| Thing | Ceiling |
| --- | --- |
| Function | 50 lines |
| Nesting depth | 4 |
| Function parameters | 4 |
| Source file | 400 lines |

All four are review, not gates. The previous attempt gated file length at 300
lines and the rule started splitting files for its own sake: two files in that
repository carry headers admitting the split was forced by the rule rather than
by anything a reader would recognise. A long file of short, obvious functions is
fine, which is why `openaccess.ts` is allowed to be the length it is. A short
file with one 200 line function is not.

Adding a linter to enforce these is a dependency, a config file and a version to
keep current, against a codebase one person can read in an afternoon. When this
repository is twice the size, revisit it in an ADR.

## 7. Readable by a volunteer at 2am

The maintainers are the constraint, not the machines.

- Name things after what they are in the lab. `CardSlot`, not
  `EntityIdentifierValueObject`. The domain words are in `docs/glossary.md`.
- Boring and obvious beats clever and short. A loop that reads clearly beats a
  chain of four higher order functions.
- No abbreviations outside the glossary.
- Comments explain why, never what. If a comment restates the code, delete it.
  If the code needs a comment to say what it does, rewrite the code.
- Every non obvious constant names its source. The `200` in the door service
  gets `// NUMUSERS, line 132` and the firmware it was read from.
- Errors say what happened, what the system did, and what to do next. "The
  controller could not be reached. Nothing was changed and cards already on the
  controller still open the door. Check that it is powered." is an error
  message. "ECONNREFUSED" is not.
- No abstraction earns its place until there are three real uses. Two is a
  coincidence.

## 8. Research before choosing

Do not pick a library or an architecture from memory. Before any dependency or
architectural decision, name three real alternatives, check each one's last
release, issue count, license and whether more than one person maintains it,
then write it down in `docs/decisions/` using the template there. State the
decision, the runner up, and the one condition that would flip it.

An ADR is half a page. Its value is that in three years somebody can see the
choice was considered rather than defaulted into. Reversing a decision is fine.
Reversing it without writing down what changed is not.

A new dependency is a decision. There are eight, they are listed in the README,
and adding a ninth is an ADR.

## 9. Cite what you borrowed

If a design, algorithm, schema or more than a few lines of code came from an
open source project, say so where the code lives and comply with the license. A
borrowed file carries a header naming the project, the URL, the license and the
version. `ATTRIBUTIONS.md` lists every dependency and every borrowed pattern.

The existing HeatSync work counts. The Rails application and the Arduino
firmware have authors, and where this project takes their schema, protocol or
tokens, it says so.

## 10. Documentation that stays true

Documentation lives next to the thing it documents and ships in the same change.

- Every API route is a row in the table in `README.md` and a line in
  `api/src/index.ts`. Adding a route adds both. There is no OpenAPI document
  until something outside this repository needs one, and a rule that names an
  artifact nobody builds is a rule people learn to skip.
- Runbooks for anything a volunteer might do at 2am live in `docs/runbooks/`, as
  numbered steps with the expected output at each step.
- A change that alters behaviour and does not touch documentation is incomplete.
- Never document code that does not exist yet.
- `HANDOFF.md` carries what is not done and what nobody has confirmed. Adding to
  it is not an admission, it is the point.

Do not document the obvious. A README explaining what `npm install` does is
noise that trains people to skip READMEs.

## 11. Copy that does not read as machine written

The lab's voice comes from the HeatSync brand guide. It applies to error
messages, documentation, commit messages and code comments.

**No em dashes or en dashes.** Anywhere. And do not route around it: replacing an
em dash with `--` in running prose is the same tell wearing a hat. Restructure
the sentence.

**No emoji.** Never in documentation, never in commit messages, and above all
never as an icon. An emoji standing in for an icon renders differently on every
platform, carries no accessible name and cannot inherit a colour. This is a
correctness rule, not a taste rule.

Tells to avoid: "it is not just X, it is Y"; the rule of three, over and over;
uniform sentence length; summary closings that restate what was just said;
rhetorical question openers; hedging stacks; bold mid sentence for emphasis.

Banned vocabulary: unleash, unlock, elevate, empower, revolutionise, transform
your, game changer, cutting edge, state of the art, seamless, robust of a
community, leverage as a verb, synergy, ecosystem, innovate, innovation,
disrupt, world class, best in class, passionate about, dive in, delve, journey
of a person learning something, thrilled to announce, excited to share, we are
proud to, whether you are a beginner or a pro, endless possibilities, one stop
shop, thriving community. Also: community used as a decorative adjective.
HeatSync members build things.

Specific to this project: no militarised framing, no exclusion by implication
("even if you have never soldered" is fine, "for serious makers" is not), no
softened safety copy (if certification is required, write required), and no
numbers nobody checked.

*Gate:* `make voice`, over markdown, source, SQL and compose files, and CI runs
it. A file whose job is to document the bans carries `voice-check: reference` in
its first 40 lines. A block quoting somebody else's words is wrapped in
`<!-- voice-check: quote -->` and `<!-- /voice-check: quote -->`.

## 12. Data belongs to the member

This system holds names, phone numbers, emergency contacts, payment records,
signed waivers and a log of who entered a building and when.

- Never commit a secret, a dump, a real email address or a real card number.
  Seed data is invented and obviously invented, which is why every address in
  `scripts/seed.sql` ends in `.invalid`.
- Never copy production data onto a laptop. Work against seeded local data or an
  anonymised staging copy.
- Door events are readable by the member they concern and by admins, and by
  nobody else.
- Privileged actions are written to an append-only audit log with who and when,
  in the same transaction as the change.
- The controller password and the database password each have exactly one holder
  process. The ADR that introduces a secret names which.
- Passwords, session tokens, service token secrets and placements never reach a
  log line. Card ids do, because `door_events` is the debugging tool for the
  door.

## 13. Order of operations

Two gates come before everything:

1. A verified, restorable backup of the production members database exists, and
   the restore has been proven onto a staging copy.
2. The door keeps working. Every change is built so physical cards open the door
   even when everything in this repository is down, and so that this service
   being up and confidently wrong cannot empty the controller's card table.

## 14. When you are stuck or wrong

Ask one question early rather than build the wrong thing for a day. If you find
a real problem with a task as specified, say it in a sentence or two, then keep
building under a stated assumption. If you get something wrong, fix it and move
on: no long narration, no repeated apology, no defensive comment in the code
explaining the previous mistake. If an earlier decision now looks wrong, open an
ADR that supersedes it rather than quietly doing it differently in one corner.

Report what you did not finish. Every time.
