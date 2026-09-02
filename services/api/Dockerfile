# Build context is the repository root, because this is a pnpm workspace.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @hsl/api build
# --legacy because this workspace does not inject workspace packages. Note that
# --prod does not drop a workspace dependency's own devDependencies, so the
# runtime image carries about 110 MB of build tooling it never runs. See
# docs/operations.md. Fixing it properly means bundling the service to a single
# file, which is a change worth making deliberately rather than in passing.
RUN pnpm deploy --filter @hsl/api --prod --legacy /out

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app
# The runtime runs dist. Sources and build configs are not part of it.
RUN rm -rf /app/src /app/tsconfig*.json /app/vitest.config.ts
# The public status document. Baked in rather than mounted, so there is no host
# path that can be missing and leave the lab website reading a fallback.
COPY infra/space_api.template.json /app/space_api.template.json
ENV SPACE_API_TEMPLATE_PATH=/app/space_api.template.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
