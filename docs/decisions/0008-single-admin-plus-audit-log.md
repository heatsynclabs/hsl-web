# 0008. One admin acting immediately, plus an audit log

Date: 2026-09-11
Status: accepted

## Context

Granting door access, issuing a card and changing a role are the actions worth
controlling. A lab with a handful of active admins can either require two of
them for a change, or require one and make every change visible afterwards.

## Alternatives

| Option | Why not |
| --- | --- |
| Two-admin approval | One table, one route and a refusal test, and it is cheap to add. What it costs is a member standing at a locked door at 9pm while the second admin is asleep. |
| A request queue anybody can file into | The same latency, plus a screen nobody checks. |
| Nothing recorded | Not an option. Rule 12 in `CONTRIBUTING.md` exists. |

## Decision

One admin acts immediately. Every privileged change writes an audit row in the
same transaction as the change, through one helper that takes the audit fields
as required arguments, so a privileged write with no audit row cannot be
expressed.

`audit_log` is append only, enforced by a database trigger rather than by
convention, and is kept forever.

## Consequence

Easy: a member who turns up at 9pm gets in. Every change has a who, a what and a
when, permanently.

Hard: one compromised or mistaken admin account can do damage that is visible
afterwards rather than prevented. That is the trade, and the board should be
told it in those words.

Flip condition: the board asks for approvals. It is one table, one route and a
refusal test, and knowing now is far cheaper than knowing later.
