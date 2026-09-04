<!-- voice-check: reference -->

# Working rules

This repository runs the members database and unlocks a building for a 501(c)(3).
Two previous rewrites stalled on the members side. These rules exist to keep this
one small enough to finish and plain enough to maintain.

Short version: keep it simple, prove it works, write it so a volunteer can fix it
at 2am.

## 1. Attribution

Never name a language model as an author, co-author, contributor, or reviewer.
Not in commit messages, trailers, pull request bodies, changelogs, comments, or
package metadata. The person who ran the session is the author.

Banned anywhere in a commit message or pull request body:

```
Co-Authored-By: Claude
Generated with Claude Code
Claude-Session:
Assisted-By:
AI-Generated:
```

*Gate:* `.githooks/commit-msg`, enabled locally with `make hooks` and run by CI
over every commit in a pull request. CI is the half that holds: a local hook runs
only for somebody who enabled it and did not pass `--no-verify`.

## 2. Never assume

Every factual claim about this codebase or the systems it talks to traces to
something checked in this session. Read version numbers, environment variable
names, config keys, API paths and column names from the source, never from
memory. "Should work" and "typically" are not evidence.

When a fact is missing and cannot be checked, write the gap down:

```
ASSUMPTION: production Postgres is 9.6, not 9.x generally.
CONFIRM BY: psql -c 'select version()' on the members host.
BLAST RADIUS: the import script's use of generated columns.
```

The legacy production database has no foreign key constraints anywhere, so any
integer column named `*_id` may point at a row that does not exist. Every join
against imported data must tolerate nothing coming back.

## 3. Check the work

Nothing is done until it has been run.

- Run the thing. An API change is verified by calling the endpoint, not by
  reading the diff.
- When you claim a test passes, paste the output. When one fails, say so and show
  it.
- Migrations run against a real Postgres before merge. The test runner rebuilds
  the schema from nothing every time, so a migration that only works against an
  already migrated database fails.
- Anything touching the door runs against the fake controller before it goes near
  hardware.
- Before calling a task complete, re-read the request and list what you did not
  do.

## 4. Tests that mean something

Write the failing test first for authorization rules, the door protocol, the
legacy import, and anything touching money or access.

- Assert on behaviour a person cares about. "A member cannot read another
  member's phone number" is a test. "The repository method was called once" is
  not.
- Every authorization rule gets a test per role, including anonymous, and
  including the case that must be refused. A rule without a refusal test is
  untested.
- The door reconcile loop gets a test proving it is idempotent: run it twice
  against the same state, get the same result and no second write.
- Anything with a slot number gets a test proving slot values survive the import.
  A slot is an EEPROM address on the controller. Renumbering silently maps every
  member to the wrong door permission.
- Test the boundary, not the mock. A real Postgres in a container beats a stubbed
  query builder. A fake controller speaking the real wire protocol beats a mocked
  client object.

Coverage is collected and published. It is never gated. A threshold turns
coverage into the goal, and then somebody writes a test that executes a module
and asserts nothing.

## 5. Separation of concerns

Dependencies point one way only:

```
apps/*         members, signup, admin
  |            may import: packages/*
  v
packages/*     ui, schema
  |            may import: other packages/*
  v
services/*     api, door
               may import: packages/* only
```

- An app never talks to Postgres. It talks to the API.
- The API never speaks the door wire protocol. It calls the door service.
- The door service is the only thing holding the controller password and the only
  thing that opens a socket to the controller.
- Each business rule lives in exactly one place. If a rule is checked in the UI
  and in the API, the UI check is a courtesy to the user and says so in a
  comment. The API check is the rule.
- A package exports through its index. Reaching into another package's internal
  path is a boundary violation, not a shortcut.
- Presentation does not fetch. Fetching does not render.

*Gate:* `eslint-plugin-boundaries`. A violation fails CI, it does not warn.

## 6. No monolithic files

| Thing | Ceiling | Gated |
|---|---|---|
| Function | 50 lines | yes |
| Cyclomatic complexity | 10 | yes |
| Function parameters | 4 | yes |
| Nesting depth | 4 | yes |
| Source file | 300 lines | no, review only |

The first four are the ones that catch real complexity, and they are cheap to
satisfy honestly. File length is a guideline and deliberately not a gate. The
previous attempt gated it at 300 lines and the rule started splitting files for
its own sake: two files in that repository carry headers admitting the split was
forced by the rule rather than by anything a reader would recognise. A long file
of short, obvious functions is fine. A short file with one 200 line function is
not.

Generated files and migrations are exempt from all of it and are listed
explicitly in the lint config with a reason, never by a blanket glob. A function
that must exceed a ceiling carries an inline disable with a one line
justification. "It is all related" is not a justification.

*Gate:* ESLint `max-lines-per-function`, `complexity`, `max-params`, `max-depth`.

## 7. Readable by a volunteer at 2am

The maintainers are the constraint, not the machines.

- Name things after what they are in the lab. `CardSlot`, not
  `EntityIdentifierValueObject`. The domain words are in `docs/glossary.md`.
- Boring and obvious beats clever and short. A loop that reads clearly beats a
  chain of four higher order functions.
- No abbreviations outside the glossary.
- Comments explain why, never what. If a comment restates the code, delete it. If
  the code needs a comment to say what it does, rewrite the code.
- Every non obvious constant names its source. The `200` in the door service gets
  `// EEPROM user slot ceiling, Open_Access_Control firmware`.
- Errors say what happened, what the system did, and what to do next.
- No abstraction earns its place until there are three real uses. Two is a
  coincidence.

## 8. Research before choosing

Do not pick a library or an architecture from memory. Before any dependency or
architectural decision, name three real alternatives, check each one's last
release, issue count, license and whether more than one person maintains it, then
write it down in `docs/decisions/` using the template there. State the decision,
the runner up, and the one condition that would flip it.

An ADR is half a page. Its value is that in three years someone can see the
choice was considered rather than defaulted into. Reversing a decision is fine.
Reversing it without writing down what changed is not.

## 9. Cite what you borrowed

If a design, algorithm, schema or more than a few lines of code came from an open
source project, say so where the code lives and comply with the license. A
borrowed file carries a header naming the project, the URL, the license and the
version. `ATTRIBUTIONS.md` lists every dependency and every borrowed pattern.

The existing HeatSync work counts. The Rails app, the Arduino firmware and the
GANTRY design system have authors, and where this project takes their schema,
protocol or tokens, it says so.

## 10. Documentation that stays true

Documentation lives next to the thing it documents and ships in the same change.

- Every package and service has a `README.md` answering four questions in order:
  what it is, how to run it, how to test it, what it depends on.
- Every API route is described in the OpenAPI document, generated from the code
  so it cannot drift.
- Runbooks for anything a volunteer might do at 2am live in `docs/runbooks/`, as
  numbered steps with the expected output at each step.
- A change that alters behaviour and does not touch documentation is incomplete.
- Never document code that does not exist yet.

Do not document the obvious. A README explaining what `pnpm install` does is
noise that trains people to skip READMEs.

## 11. Copy that does not read as machine written

The lab's voice comes from the HeatSync brand guide. It applies to UI strings,
error messages, documentation, commit messages and code comments.

**No em dashes or en dashes.** Anywhere. And do not route around it: replacing an
em dash with `--` in running prose is the same tell wearing a hat. Restructure the
sentence.

**No emoji.** Never in UI, never in documentation, never in commit messages, and
above all never as an icon. An emoji standing in for an icon renders differently
on every platform, carries no accessible name, cannot be styled and cannot
inherit a token colour. Use an inline SVG from the icon set. This is a
correctness rule, not a taste rule.

Tells to avoid: "it is not just X, it is Y"; the rule of three, over and over;
uniform sentence length; summary closings that restate what was just said;
rhetorical question openers; hedging stacks; bold mid sentence for emphasis.

Banned vocabulary: unleash, unlock, elevate, empower, revolutionise, transform
your, game changer, cutting edge, state of the art, seamless, robust of a
community, leverage as a verb, synergy, ecosystem, innovate, innovation, disrupt,
world class, best in class, passionate about, dive in, delve, journey of a person
learning something, thrilled to announce, excited to share, we are proud to,
whether you are a beginner or a pro, endless possibilities, one stop shop,
thriving community. Also: community used as a decorative adjective. HeatSync
members build things.

Specific to this project: no militarised framing, no exclusion by implication
("even if you have never soldered" is fine, "for serious makers" is not), no
softened safety copy (if certification is required, write required), and no
numbers nobody checked.

*Gate:* `tools/voice-check` over markdown, UI copy, comments and commit messages.
A file whose job is to document the bans carries `voice-check: reference` in its
first 40 lines. A block quoting somebody else's words is wrapped in
`<!-- voice-check: quote -->` and `<!-- /voice-check: quote -->`.

## 12. Data belongs to the member

This system holds names, addresses, phone numbers, emergency contacts, payment
records, signed waivers and a log of who entered a building and when.

- Never commit a secret, a dump, a real email address or a real card number. Seed
  data is invented and obviously invented.
- Never copy production data onto a laptop. Work against seeded local data or an
  anonymised staging copy.
- Door logs are readable by the member they concern and by admins, and by nobody
  else.
- Privileged actions are written to an append-only audit log with who and when.
- The controller password and the database password each have exactly one holder
  process. The ADR that introduces a secret names which.

## 13. Order of operations

Two gates come before everything:

1. A verified, restorable backup of the production members database exists, and
   the restore has been proven onto a staging copy.
2. The door keeps working. Every phase is built so physical cards open the door
   even when everything in this repository is down.

## 14. When you are stuck or wrong

Ask one question early rather than build the wrong thing for a day. If you find a
real problem with a task as specified, say it in a sentence or two, then keep
building under a stated assumption. If you get something wrong, fix it and move
on: no long narration, no repeated apology, no defensive comment in the code
explaining the previous mistake. If an earlier decision now looks wrong, open an
ADR that supersedes it rather than quietly doing it differently in one corner.

Report what you did not finish. Every time.
