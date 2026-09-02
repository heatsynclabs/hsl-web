# 0006. Migrations are generated SQL, applied with migrate

Date: 2026-09-01
Status: accepted

## Context

drizzle-kit offers two workflows. `push` diffs the schema against the database
and applies the change directly. `generate` emits a SQL file that gets committed,
and `migrate` applies committed files in order.

Drizzle's stable npm tag is 0.45.2, published 2026-03-27. The vendor's own
install documentation says `drizzle-orm@rc`, which is 1.0.0-rc.4 and carries a
breaking casing API change. No stable 1.0.0 exists.

## Alternatives

| Option | Why not |
|---|---|
| `drizzle-kit push` | Its `--force` flag auto-accepts data-loss statements, nothing is reviewable in a diff, and section 4 of the working rules requires migrations to run against a real Postgres before merge with the schema rebuilt from nothing. That needs committed SQL. |
| Follow the vendor docs onto the release candidate | A volunteer following the docs and a volunteer following the lockfile end up on incompatible APIs. |

## Decision

Pin `drizzle-orm` and `drizzle-kit` to exact versions, not caret ranges. Use
`drizzle-kit generate` and commit both the `.sql` file and the snapshot. Apply
with `drizzle-kit migrate`.

Exact pinning matters more than usual here: a caret range plus a future 1.0
stable would move everyone across a breaking change with no commit.

## Consequence

Easy: every schema change is readable SQL in a pull request. This is the class of
change where that matters most, because a renumbered card slot silently maps a
member to the wrong door permission.

Hard: the generated migrations directory has to be exempted from the file length
ceiling explicitly, with the reason recorded, per section 6.

Flip condition: drizzle-orm 1.0.0 stable is published. Treat the upgrade as
scheduled work, not a surprise.
