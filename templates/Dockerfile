# Multi-stage build for the openrm "app" service (optional -- see
# templates/docker-compose.yml). Not built or run by the tool that authored
# this repository; provided for end users who want to containerize openrm.

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY templates ./templates
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
RUN npx prisma generate --schema=./prisma/schema.prisma

ENTRYPOINT ["node", "dist/cli/index.js"]
