# 0002. The stack

Date: 2026-09-01
Status: accepted

## Context

One language across the whole system means anyone who can read TypeScript can
read all of it, schemas included, and there is nothing a future maintainer has to
learn as a separate discipline. Every version below was read off the npm registry
on 2026-09-01, not from memory.

## Alternatives

| Piece | Chosen | Runner up | Why not the runner up |
|---|---|---|---|
| API framework | Hono 4.13.5 | Fastify 5.12.1 | Both are fine. Hono's Node deployment is `node dist/index.js` with no adapter. Fastify has the better governance story and is the fallback if Hono's type inference gets slow. |
| Database | Postgres 18 | SQLite | Two services read this data and the backup story for Postgres is already solved. The data is already in Postgres. |
| Schema and queries | Drizzle 0.45.2 | Kysely 0.29.5 | Kysely is arguably more boring, but its `Database` interface is either generated or hand-maintained beside the migrations, and both drift. Drizzle's schema file reads like the SQL it emits. |
| Validation | Zod 4.5.4 | Valibot | One library shared by the API, the door service and the apps. Zod is what the Hono validator middleware speaks. |
| Auth | better-auth 1.7.2 | Ory Kratos, Zitadel, Keycloak | Those are products to deploy, upgrade and theme. This is a library inside the API service. See 0004. |
| Apps | Vue 3.5.42 on Vite 8.2.2 | Nuxt | Nuxt's own docs push an internal app with no SEO requirement to `ssr: false`, at which point it emits static files that `vite build` emits directly, having paid for Nitro, a filesystem router and auto-imports. Auto-imports also make the import graph invisible, which section 5 forbids. |
| Monorepo | pnpm workspaces alone | Turborepo, Nx | Eight packages and three volunteers is not the repository those tools are for. `turbo.json` becomes a second dependency graph to keep in sync. |
| Proxy | Caddy | Traefik, nginx | Traefik's normal mode mounts the Docker socket into the process serving the public port. nginx needs certbot bolted on. Caddy gets automatic TLS with no configuration. |
| Node image | node:24-alpine, pinned to a patch | node:lts-alpine | The LTS pointer moves to 26 in October 2026, and 26 does not bundle corepack. An unpinned tag breaks the build on a day with no commit to blame. |

## Decision

The versions above, declared once in the `catalog:` block of
`pnpm-workspace.yaml`. Packages write `catalog:` instead of a version.

Deliberately absent: Nuxt, Pinia, TanStack Query, Storybook, Histoire, Turborepo,
Nx, vee-validate, tRPC, NestJS, Prisma, an OpenAPI layer.

## Consequence

Easy: one version of everything, changed in one place. Nothing here needs a code
generation step that people forget to run.

Hard: two of these pins are against the current published latest, for reasons
recorded in 0009 (TypeScript) and 0006 (Drizzle). Both need re-reading when the
upstream situation changes.

Flip conditions live in the per-piece ADRs.
