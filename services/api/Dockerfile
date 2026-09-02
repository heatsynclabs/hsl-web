# Build context is the repository root, because this is a pnpm workspace.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# ...^... builds @hsl/schema first, because the services import its emitted
# JavaScript rather than its TypeScript source. See packages/schema/package.json.
RUN pnpm --filter @hsl/api^... build && pnpm --filter @hsl/api build
# --legacy because this workspace does not inject workspace packages. Note that
# --prod does not drop a workspace dependency's own devDependencies, so the
# runtime image carries about 110 MB of build tooling it never runs. See
# docs/operations.md. Fixing it properly means bundling the service to a single
# file, which is a change worth making deliberately rather than in passing.
RUN pnpm deploy --filter @hsl/api --prod --legacy /out

# The legacy import. It runs from source with node's type stripping rather than
# from dist, because it is a one-shot that runs once per environment and does not
# need a build of its own. See compose.legacy.yaml.
FROM build AS tools
WORKDIR /repo
ENTRYPOINT ["node", "--experimental-strip-types", "tools/import/main.ts"]

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app
# The runtime runs dist. Sources and build configs are not part of it.
RUN rm -rf /app/src /app/tsconfig*.json /app/vitest.config.ts
# The public status document. Baked in rather than mounted, so there is no host
# path that can be missing and leave the lab website reading a fallback.
COPY infra/space_api.template.json /app/space_api.template.json
# The migrate container runs from this image and needs the SQL beside dist.
COPY packages/schema/migrations /app/migrations
ENV SPACE_API_TEMPLATE_PATH=/app/space_api.template.json
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
