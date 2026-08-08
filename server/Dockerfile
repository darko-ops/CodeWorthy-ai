# CodeWorthy Steward — production image.
# Multi-stage: build with the full toolchain, ship a lean runtime.

# ── build ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY db ./db
RUN npm run build
# tsc doesn't copy .sql — the compiled migrator reads dist/db/migrations at runtime.
RUN cp -r db/migrations dist/db/migrations

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# Prod deps only; the SDKs we dynamic-import (aws, nodemailer, anthropic) are
# runtime deps, so they're included. tsx/vitest/typescript are not.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 8080
# release_command in fly.toml runs the migration; this just serves.
CMD ["node", "dist/src/index.js"]
