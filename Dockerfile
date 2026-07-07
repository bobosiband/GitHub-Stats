# syntax=docker/dockerfile:1.7

# ── deps ─────────────────────────────────────────────────────────────────────
# Install prod-only dependencies against a clean lockfile. Prisma is a prod dep
# (we run `prisma migrate deploy` at startup), so it's already in npm ci output.
FROM node:20-alpine AS deps
WORKDIR /app

# Prisma engines need openssl on Alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl \
 && addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY openapi.json ./openapi.json

# Generate the Prisma client for the runtime image.
RUN npx prisma generate

USER app
EXPOSE 3000

# Migrations run BEFORE the server boots on every release. `migrate deploy` is
# non-destructive (applies pending migrations, no-ops if current) — the database
# survives every deploy.
CMD ["npm", "run", "start:deploy"]
