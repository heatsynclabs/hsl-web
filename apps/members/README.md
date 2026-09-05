# @hsl/members

The app a member signs into. It holds the profile, the membership and dues
record, the member's own cards and certifications, and the door controls. Sign
in lives here too, because Caddy serves all three apps and the API from one
origin and they share one session cookie.

Five routes:

| Path | Screen |
|---|---|
| `/sign-in` | email, password, and the link to the reset form |
| `/forgot-password` | asks the API to send a reset link |
| `/reset-password` | where the emailed link lands. Reachable while signed in, because a member who is signed in on one device can still be resetting on another |
| `/` | profile, membership, door access and certifications |
| `/door` | the two door tiles, the controls, and what this browser has sent |

`/` is desktop first and collapses to one column below 720px. `/door` is phone
first. Both tables scroll inside their own card rather than moving the page
sideways.

## Running it

```
pnpm --filter @hsl/members dev
```

Vite proxies `/api` and `/space_api.json` to `http://127.0.0.1:3000`, so run the
API first. In production Caddy serves the built files at the site root and
proxies the same two paths to the API, which is why the client's base URL is the
empty string and there is no CORS anywhere.

## Testing it

```
pnpm --filter @hsl/members test
pnpm --filter @hsl/members typecheck
pnpm --filter @hsl/members build
```

Most suites render with `renderToString`. That shapes the code: a screen awaits
its request in `setup` and `App.vue` holds the `Suspense` boundary that draws the
loading state, so the server renderer resolves a screen before it renders and a
test can assert on what a person would see.

The profile form is tested by typing into it under jsdom, because the two skills
boxes hold paragraphs and the line breaks have to survive the save.

`src/test-fixtures.ts` holds an invented member. Nothing there came from the
production dump.

## What it depends on

`@hsl/ui` for the components and the GANTRY tokens, `@hsl/schema` for the
contract and `memberLevelLabel`, and `@hsl/api-client` for every request after
sign in. `vue`, `vue-router` and `vite` are pinned in the workspace catalog.

## One thing a reader should know

**Sign in does not go through `@hsl/api-client`.** Those four routes belong to
better-auth, which serves them at `/api/auth`, so `src/lib/auth.ts` drives
better-auth's own Vue client instead. It exists to turn two answer shapes into
one: a refusal arrives as a value and a dead network throws, and both leave that
file as an `AuthError` carrying a sentence a member can act on. See
`docs/decisions/0012-better-auths-own-client.md`.

Everything after sign in goes through `@hsl/api-client` and the session it holds.

## The door screen and the two-admin note

`docs/decisions/0008-single-admin-plus-audit-log.md` replaced two-admin approval
with an audit log, so the mockup line "Grants and revokes need two admins by lab
rule" is false. The card panel says what is true instead: one admin acts alone
and every change is written to the audit log with who made it and when.

Rear unlock is rendered and disabled with the reason beside it, per the lab
decision of 2018-02-22. A hidden control invites somebody to add it back. The
refusal itself is the API's, in `services/api/src/routes/door.ts`.

The recent list is what this browser has sent since the screen opened. There is
no member-facing door event route in the route table, so the screen does not
pretend to show the building's history.
