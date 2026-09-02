# Build context is the repository root, because this is a pnpm workspace.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @hsl/door build
RUN pnpm deploy --filter @hsl/door --prod --legacy /out

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
