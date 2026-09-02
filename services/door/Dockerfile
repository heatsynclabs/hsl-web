# Build context is the repository root, because this is a pnpm workspace.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# ...^... builds @hsl/schema first, because the service imports its emitted
# JavaScript rather than its TypeScript source. See packages/schema/package.json.
RUN pnpm --filter @hsl/door^... build
# One self-contained file, replacing pnpm deploy. See
# docs/decisions/0013-services-ship-as-a-bundle.md.
RUN pnpm --filter @hsl/door bundle

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/services/door/dist /app/dist
# For "type": "module", so node reads the bundle as ESM. Nothing installs from
# it and there is no node_modules in this image.
COPY --from=build /repo/services/door/package.json /app/package.json
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
