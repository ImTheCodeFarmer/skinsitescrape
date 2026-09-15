# Railway: root directory = repo root, dockerfile path = apps/web/Dockerfile
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.11.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web...

FROM deps AS build
COPY packages/db packages/db
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @casino/db build && pnpm --filter web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
