# 0012. The members app uses better-auth's own client

Date: 2026-09-02
Status: accepted

## Context

`@hsl/api-client` covers the fifteen routes this repository writes and
deliberately does not cover `/api/auth/*`, which better-auth serves. The members
app reached those four routes with hand-written `fetch` calls whose paths and
request bodies were read out of better-auth 1.7.2's published sources and copied
into a comment.

That is a contract kept true by hand across upgrades, and 0004 records what the
failure looks like when a better-auth detail is wrong: a silent
`INVALID_EMAIL_OR_PASSWORD` for the whole membership with nothing in the logs.

## Alternatives

| Option | Why not |
|---|---|
| Keep the hand-written calls | No new dependency in an app, and the call sites name the file and line each path came from. But the next better-auth upgrade has to be read against four hand-copied shapes, and nothing fails at compile time when one moves. |
| `better-auth/client`, the framework-agnostic client | Same paths, same request shapes, without nanostores and the Vue store adapter. The app's session state comes from `@hsl/api-client` over `GET /api/me`, so better-auth's `useSession` is not used and this would be enough. |
| `better-auth/vue` | Chosen. |

## Decision

`apps/members` depends on `better-auth` and builds the client with
`createAuthClient` from `better-auth/vue`. `lib/auth.ts` keeps its four
functions and its `AuthError`, because the client answers a refusal as a value
and a dead network as a throw, and the screens should read one shape.

The client is built with no options. Read from
`dist/client/config.mjs` in the installed 1.7.2: with no `baseURL` it resolves
`window.location.origin + '/api/auth'` and sends `credentials: 'include'`, which
is the same origin Caddy already serves the app and the API on.

## Consequence

Easy: the paths and the bodies are the library's to keep true. The compiler now
checks the argument shapes, which it could not do against a hand-written string.

Hard: `better-auth` is in an app's dependency graph, and the client captures
`globalThis.fetch` when it is built, so the suite imports the module fresh after
standing up its fetch. That is written down at the top of `lib/auth.test.ts`.

Flip condition: the bundle cost of the Vue client's store matters and
`useSession` is still unused, at which point `better-auth/client` is the same
change with one import line different.
