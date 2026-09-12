# Pinned by digest, so a rebuilt image is the image that was tested. The tag
# stays beside it because the digest alone says nothing about what it is.
# Read on 2026-09-12. `docker buildx imagetools inspect` confirms this digest is
# the multi-architecture index, so amd64 in CI and arm64 on a laptop both
# resolve from it.
FROM node:24.20-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf

WORKDIR /app

COPY door/package.json door/package-lock.json ./
RUN npm ci --omit=dev
COPY door/src ./src

USER node
CMD ["node", "src/main.ts"]
