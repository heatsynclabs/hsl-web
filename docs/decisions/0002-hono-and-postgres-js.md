# 0002. Hono and postgres.js, with no ORM and no auth framework

Date: 2026-09-11
Status: accepted

## Context

Thirty nine routes, thirteen tables, one process. The previous attempt used
Drizzle and better-auth, and the parts of it that were hardest to reason about
were the parts where a library's behaviour had to be worked out rather than
read: what `attr_accessible` equivalent better-auth applied to a profile update,
and which migration Drizzle would generate from a schema edit.

## Alternatives

| Option | Why not |
| --- | --- |
| Express 5 | Still maintained and would work. Hono's `Context` carries typed variables, which is what makes a guard hand a `Member` to a handler without a cast, and its router is smaller. |
| Fastify | Schema-first validation is its selling point, and section 6 of the plan is that `if` statements at this surface area are shorter and clearer than schemas. |
| Drizzle or Prisma | Thirteen tables and about sixty queries, most of which are a single statement with two parameters. An ORM here buys type inference on rows and costs a schema definition, a generator, a migration engine and a query builder to read past. `postgres.js` gives a tagged template that is the SQL, parameterised. |
| better-auth, Lucia, Auth.js | Sessions here are one table and forty lines. What a framework adds is the protocols this system decided not to speak: OIDC, OAuth providers, MFA. |

`hono` 4.13.7, MIT, released within the month, maintained by an organisation.
`postgres` 3.4.9, Unlicense, one principal maintainer, which is the one risk
worth naming: it is 4,000 lines of readable JavaScript with no dependencies, and
replacing it with `pg` is a day's work confined to `db.ts` and the query
templates.

## Decision

Hono on `@hono/node-server`, `postgres.js` for the database, `jose` for JWTs,
`@node-rs/argon2` and `bcryptjs` for passwords, `nodemailer` for mail. Eight
dependencies across both services. No ORM, no auth framework, no migration
framework, no validation library.

## Consequence

Easy: every query is the SQL somebody would type into psql. Every rule is an
`if` a reader can follow. A stack trace points at a line in this repository.

Hard: no compile-time guarantee that a row shape matches a query. The row types
are written by hand and a schema change that misses one is caught by a test
rather than by a compiler.

Flip condition: the query count passes roughly two hundred, or more than one
person is writing SQL here regularly.
