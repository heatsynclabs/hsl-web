FROM node:24.20-alpine

WORKDIR /app

COPY door/package.json door/package-lock.json ./
RUN npm ci --omit=dev
COPY door/src ./src

USER node
CMD ["node", "src/main.ts"]
