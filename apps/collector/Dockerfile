# Railway: root directory = repo root, dockerfile path = apps/collector/Dockerfile
#
# Two builders: Go compiles `wstap` (the Chrome-fingerprinted websocket client),
# Node compiles the collector. Runtime is plain node:22-alpine, no browser.
FROM golang:1.24-alpine AS wstap
WORKDIR /src
COPY apps/collector/wstap/go.mod apps/collector/wstap/go.sum ./
RUN go mod download
COPY apps/collector/wstap/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /wstap .

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/collector/package.json apps/collector/
RUN pnpm install --frozen-lockfile --filter collector...

FROM deps AS build
COPY packages/db packages/db
COPY apps/collector apps/collector
RUN pnpm --filter @casino/db build && pnpm --filter collector build

FROM build AS runtime
ENV NODE_ENV=production TRANSPORT=wstap WSTAP_PATH=/usr/local/bin/wstap
COPY --from=wstap /wstap /usr/local/bin/wstap
WORKDIR /repo/apps/collector
CMD ["sh", "-c", "pnpm --filter @casino/db migrate:prod && node dist/index.js"]
