# 0001. One repository, three apps, two services

Date: 2026-09-01
Status: accepted

## Context

The system replaces a Rails 3.2 application that does everything: members, cards,
dues, and the door. Two rewrites have stalled, both on the members side. The
shape has to be small enough that one person can hold it in their head.

## Alternatives

| Option | Why not |
|---|---|
| Separate repositories per app and service | Six repositories, six CI setups, and a shared schema that drifts. The contract between parts is the thing most likely to break, and separate repositories hide the break until deploy. |
| One application, server rendered | Loses the shared component library and makes the door service, which must run on different hardware on the lab LAN, awkward to separate. |
| Keep Rails and add services beside it | Ruby 1.9.3 and Rails 3.2.8 have had no security patches since around 2015. The point of the work is retiring them. |

## Decision

One pnpm workspace holding `packages/schema`, `packages/ui`,
`packages/api-client`, `services/api`, `services/door`, and three Vue apps:
`members`, `signup`, `admin`.

The compiler enforces the contract that documentation used to. Both services and
all three apps import the same schema package, so a column change walks you to
every place that cares.

## Consequence

Easy: changing a shared type, reviewing a change that spans the API and an app,
running the whole suite in one command.

Hard: the door service ships from the same repository but runs on a different
machine. It gets its own compose file, and it must never require the repository
to be reachable in order to run.

Flip condition: the door service acquires a maintainer who does not work on the
rest, or the lab runs door hardware for a second site.
