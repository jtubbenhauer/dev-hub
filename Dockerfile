FROM node:20-alpine

# Build toolchain for better-sqlite3 and runtime deps
RUN apk add --no-cache python3 make g++ git bash

RUN corepack enable

WORKDIR /app

# Manifests first for Docker layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/agent/package.json ./packages/agent/

RUN pnpm install --frozen-lockfile

COPY . .

RUN mkdir -p /data

ENV NEXT_TELEMETRY_DISABLED=1
ENV DB_PATH="/data/dev-hub.db"
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

CMD ["bash", "start.sh"]
