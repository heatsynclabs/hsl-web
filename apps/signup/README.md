# @hsl/signup

The join flow. Five screens that collect an account, an emergency contact, an
accepted release and a dues tier, then send all of it to `POST /api/signup` in
one request. Caddy serves it under `/signup` on the same origin as the members
app and the API.

What it deliberately does not do:

- It never handles a card number and never says a payment happened. Dues are
  collected offline by Zelle, PayPal, cash or cheque, and an accountant records
  them later.
- It does not book orientation. A person runs that.
- It is not the liability release. The lab's release is a paper form and a
  Google Form. This records that somebody accepted it and when, as a pointer to
  the instrument the lab keeps, and the waiver screen says so.
- It creates nothing until the last step, so an abandoned form leaves no half
  built member behind.

## Running it

```
docker compose up -d db api
pnpm --filter @hsl/signup dev
```

Vite serves it at `/signup/` and proxies `/api` and `/space_api.json` to
`http://127.0.0.1:3000`, which is what Caddy does in production. The base path
is set in `vite.config.ts`: the Caddyfile strips `/signup` before the file
server sees it, so a build without the base asks the members app for its
assets.

## Testing it

```
pnpm --filter @hsl/signup test
pnpm --filter @hsl/signup typecheck
pnpm --filter @hsl/signup build
```

`src/join-flow.ts` holds the draft, the per-field validation and the one call to
the API, so most of the behaviour is tested without rendering anything: what the
schema refuses, that nothing is sent before the last step, and that an email
which already has an account offers sign in rather than a status code. The view
suites render with `renderToString`, which is enough for a flow whose decisions
are all in `join-flow.ts`.

## What it depends on

`@hsl/ui` for the components and the tokens, `@hsl/api-client` for the session
and the one POST, `@hsl/schema` for `signupRequest`, `signupTier` and
`memberLevelLabel`, plus `vue`, `vue-router` and `zod`. The dues tiers on offer
are read out of `signupTier`, so a tier the API stops accepting stops being
offered here.
