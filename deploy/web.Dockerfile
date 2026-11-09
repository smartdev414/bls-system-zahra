# syntax=docker/dockerfile:1
#
# Production image for the BLS web app (Next.js standalone server).
# Build context: repo root.
#   docker build -f deploy/web.Dockerfile --target web     -t bls-web .
#   docker build -f deploy/web.Dockerfile --target migrate -t bls-migrate .
#
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they
# are build args (set as GitHub repository variables), not runtime env.
# (The repo-root Dockerfile is the LiveKit caption agent, not this.)

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS base
RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM deps AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_PUSHER_KEY
ARG NEXT_PUBLIC_PUSHER_CLUSTER
ARG NEXT_PUBLIC_TLDRAW_LICENSE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_PUSHER_KEY=$NEXT_PUBLIC_PUSHER_KEY \
    NEXT_PUBLIC_PUSHER_CLUSTER=$NEXT_PUBLIC_PUSHER_CLUSTER \
    NEXT_PUBLIC_TLDRAW_LICENSE_KEY=$NEXT_PUBLIC_TLDRAW_LICENSE_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    # lib/prisma.ts throws at import without it; nothing connects during the
    # build. The real URL is set at runtime by docker-compose.
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
COPY . .
RUN npm run build

# ---- database migrations (one-shot job run before each release) ----
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime ----
FROM base AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
