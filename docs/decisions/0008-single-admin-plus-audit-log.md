# 0008. Single admin plus an audit log, not two-admin approval

Date: 2026-09-01
Status: accepted

## Context

The app mockups lead the admin screen with an approval queue: a card grant waits
for a second admin, and proposers cannot approve their own. The architecture plan
removed it and replaced it with an audit log. The field manual notes that under
the bylaws, changing who has card access is a governance decision.

The two documents disagree, and the screens cannot be built until it is settled.

## Alternatives

| Option | Why not |
|---|---|
| Two-admin approval on everything | A pending state on every privileged change, a proposals table, approval screens, and a rule that has to be enforced in the database rather than the page. Real cost for a lab with a handful of admins who are usually in the same room. |
| Two-admin approval on card access only | The narrowest defensible version, and the one to reach for if the board asks. Still a table, a route, two screens and a refusal test. |

## Decision

Any admin acts immediately. Every privileged change writes an append-only row to
`audit_log` recording actor, action, target and time. The admin app gets an audit
screen in place of the approvals card.

## Consequence

Easy: every admin route is one function with one write beside it. No pending
state to reason about, no half-applied changes.

Hard: a mistaken or malicious grant takes effect at once and is caught after the
fact rather than prevented. The audit log is what makes it visible, so it has to
be genuinely append-only, enforced in the database.

Two member-facing strings from the mockups become false and are rewritten:
"Grants and revokes need two admins by lab rule" and "Role and card changes open
an approval."

Flip condition: the board asks for approvals. It is one table, one route, and a
component that is already designed.
