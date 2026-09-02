# 0003. A hand-written typed client, not Hono RPC

Date: 2026-09-01
Status: accepted

## Context

The Vue apps need types for API requests and responses without a code generation
step. Hono's RPC gives that through `hc<typeof appRoutes>`, which imports a type
from `services/api` into `apps/*`. The dependency direction in section 5 of the
working rules forbids an app importing from a service, and
`eslint-plugin-boundaries` will fail on it.

## Alternatives

| Option | Why not |
|---|---|
| Hono RPC, with a type-only exception carved into the boundary rule | Less code, and it keeps route-shape inference. But it constrains how every route is written: all routes chained in one expression, an explicit status literal on every `c.json`, no `.then()` in handlers, and a precompiled wrapper so the editor does not pay the instantiation cost. Those constraints are invisible in the source and painful to retrofit. |
| Generate a client from OpenAPI | The code generation step this is trying to avoid. |

## Decision

The contract lives in `packages/schema` as Zod request and response schemas.
`packages/api-client` is a hand-written typed client over `fetch`, importing
those schemas. Apps import the client. The API imports the same schemas to
validate.

## Consequence

Easy: the boundary graph stays true and enforceable. The client is one small file
per resource that a volunteer can read end to end. No hidden constraints on how
routes are written.

Hard: adding a route means touching the schema package and the client, not just
the service. With around fifteen routes that is a few lines each, and the
compiler catches a forgotten one.

Flip condition: the route count grows past what a hand-written client can track,
or a second non-Vue consumer needs types.
