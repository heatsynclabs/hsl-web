# 0007. Postgres for tests comes from Compose

Date: 2026-09-01
Status: accepted

## Context

Section 4 of the working rules says to test the boundary rather than the mock,
and to prefer a real Postgres in a container over a stubbed query builder. It
also requires the schema to be rebuilt from nothing on every run.

## Alternatives

| Option | Why not |
|---|---|
| Testcontainers 12.1.0 | Gives per-suite isolation and random ports for free. It also means Docker socket discovery configured per developer machine and per CI runner, a per-suite container start, and a second concept beside the Compose file everyone already runs. |
| A stubbed query builder | Tests the mock. Would not have caught a single one of the real defects in the legacy system. |

## Decision

A `db` service in the development Compose file. A Vitest `globalSetup` drops the
schema in the database `DATABASE_URL` names, recreates it, and runs the
migrations against it.

One database, not one per worker. The per-worker database with
`CREATE DATABASE ... TEMPLATE` was written down here and never built, and what
keeps two suites from truncating each other's rows is `fileParallelism: false`
in `services/api/vitest.config.ts`. That is slower and it is one concept rather
than two, which is what this decision was about.

## Consequence

Easy: one concept. The thing tests run against is the thing production runs.
No library.

Hard: a developer with no Docker cannot run the database suites. The unit suites
still run.

Flip condition: per-suite isolation becomes the actual bottleneck, measured.
