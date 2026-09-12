# Pinned by digest, so a rebuilt image is the image that was tested. The tag
# stays beside it because the digest alone says nothing about what it is.
# Read on 2026-09-12. `docker buildx imagetools inspect` confirms this digest is
# the multi-architecture index, so amd64 in CI and arm64 on a laptop both
# resolve from it.
FROM node:24.20-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

WORKDIR /app

# The layout inside the image is the layout in the repository, so a path that
# works on a laptop works here. Two small dependency trees rather than one: the
# root one exists only so scripts/migrate.ts can find postgres.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY api/package.json api/package-lock.json api/
RUN npm --prefix api ci --omit=dev

COPY migrations ./migrations
COPY scripts/migrate.ts ./scripts/
COPY api/src ./api/src
COPY api/space_api.template.json ./api/

USER node
EXPOSE 3000
CMD ["node", "api/src/index.ts"]
