# @hsl/members

The app a member signs into. It holds the profile, the membership and dues
record, the member's own cards and certifications, and the door controls. Sign
in lives here too, because Caddy serves all three apps and the API from one
origin and they share one session cookie.

Four routes:

| Path | Screen |
|---|---|
| `/sign-in` | email, password, and the link to the reset form |
| `/forgot-password` | asks the API to send a reset link |
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

The suites render with `renderToString` from `@vue/test-utils`, because neither
`jsdom` nor `happy-dom` is in the workspace catalog. That shapes the code: a
screen awaits its request in `setup` and `App.vue` holds the `Suspense` boundary
that draws the loading state, so the server renderer resolves a screen before it
renders and a test can assert on what a person would see. It also means there
are no click or typing tests. The refusals that depend on a click are asserted
against `src/lib/auth.ts` instead, with `fetch` stubbed.

`src/test-fixtures.ts` holds an invented member. Nothing there came from the
production dump.

## What it depends on

`@hsl/ui` for the components and the GANTRY tokens, `@hsl/schema` for the
contract and `memberLevelLabel`, and `@hsl/api-client` for every request after
sign in. `vue`, `vue-router` and `vite` are pinned in the workspace catalog.

## Two things a reader should know

**Sign in does not use the better-auth client.** better-auth ships a Vue client
at its `better-auth/vue` export and that is what should be here, but
`better-auth` is not a dependency of this app so the import does not resolve.
`src/lib/auth.ts` posts to the three routes directly instead, and its header
names the files in the installed better-auth 1.7.2 that each path and body were
read from. Adding `better-auth` to this app's dependencies is the fix.

**The reset form cannot work yet.** `services/api/src/auth.ts` configures
`emailAndPassword` without `sendResetPassword`, so `/api/auth/request-password-reset`
answers 400 with `Reset password isn't enabled`. The screen prints what the API
says rather than claiming a link is on its way, and there is no screen for the
second half of the flow.

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
