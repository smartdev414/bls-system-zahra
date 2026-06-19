# LiveKit Cloud agent — classroom-transcriber (Inference STT captions).
# Build context: repo root (`lk agent deploy --config agents/classroom-transcriber/livekit.toml .`)
# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim AS base

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci

# Pre-download agent plugin assets (@livekit/agents native bindings, etc.)
RUN npx livekit-agents download-files

COPY agents/classroom-transcriber ./agents/classroom-transcriber

FROM base

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/agents/classroom-transcriber ./agents/classroom-transcriber

ENV NODE_ENV=production

CMD ["npx", "tsx", "agents/classroom-transcriber/index.ts", "start"]
