# @hsl/api-client

The typed client the three apps use to talk to `services/api`. One method per row
of the route table in `docs/architecture.md`, each one sending the session cookie
and parsing the answer with the schema from `@hsl/schema` that the API validated
it against.

Hand written rather than generated or inferred from the service, because an app
importing a type out of `services/api` is the boundary violation that
`docs/decisions/0003-a-hand-written-api-client.md` exists to avoid.

- `src/client.ts` `createClient({ baseUrl })` and every route method.
- `src/errors.ts` `ApiError`, the only error the client throws.
- `src/session.ts` the signed in member, fetched once per page rather than once
  per component.
- `src/index.ts` the public surface. Nothing outside reaches past it.

Sign in, sign out and password reset are not here. Those live under `/api/auth`
and better-auth ships its own client for them. What this package does after a
sign in is `loadSession`.

## Running it

There is nothing to run. It is imported.

```ts
import { createClient, loadSession, useSession } from '@hsl/api-client'

// Caddy serves the apps and the API on one origin, so the base URL is empty.
export const api = createClient({ baseUrl: '' })

await loadSession(api)          // once, at bootstrap
const session = useSession()    // in any component, no further request
```

`session.member` is the member row or `null`. `session.state` carries the status
(`idle`, `loading`, `signed-in`, `signed-out`), the whole `/api/me` answer, and
an `ApiError` when the API could not be reached. `session.subscribe(listener)`
returns the function that stops listening; a Vue component holds the state in a
`shallowRef` and calls it from `onUnmounted`.

Three things throw an `ApiError` and nothing else does: a status outside the 2xx
range, a body that does not match the contract, and no response at all. Read
`status`, `problem` and `body` off the error to render it, or print `message`,
which already says what happened, what the client did, and what to do next.

## Testing it

```
pnpm --filter @hsl/api-client test
pnpm --filter @hsl/api-client typecheck
```

The suites stub the global `fetch` and need no server. The one that matters most
is the parse failure: a member missing a field comes back from a stubbed API and
the client throws instead of putting a half filled profile on the screen.

## What it depends on

`@hsl/schema` for the contract and `zod` to parse with, both pinned in the
workspace catalog. `fetch` comes from the browser, or from Node 22 in a test. It
imports nothing else, and nothing here knows what a Vue component is.
