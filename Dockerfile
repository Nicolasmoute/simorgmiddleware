# SimOrg Middleware — production image.
# Zeabur can also build this repo directly via its Next.js buildpack; this
# Dockerfile is provided for explicit/containerised deployments.
FROM node:22-slim AS base
# Prisma needs OpenSSL at runtime.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# --- Build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000
# Apply the SQLite schema (idempotent), then start Next.js.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
