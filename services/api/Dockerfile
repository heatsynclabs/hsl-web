# Build context is the repository root, because this is a pnpm workspace.
FROM node:24.20-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @hsl/api build
RUN pnpm deploy --filter @hsl/api --prod --legacy /out

FROM node:24.20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
