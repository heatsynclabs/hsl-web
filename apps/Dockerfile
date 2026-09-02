# Builds all three apps and bakes them into one Caddy image. Nothing is bind
# mounted, so there is no host path that can be missing and silently serve an
# empty directory.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter "./apps/*" build

FROM caddy:2.11.4-alpine AS runtime
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/members/dist /srv/members
COPY --from=build /repo/apps/signup/dist  /srv/signup
COPY --from=build /repo/apps/admin/dist   /srv/admin
