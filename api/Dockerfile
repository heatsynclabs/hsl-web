FROM node:24.20-alpine

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
