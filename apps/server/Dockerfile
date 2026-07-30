FROM node:22-slim AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY runner/package.json runner/package.json
RUN pnpm install --filter @ai-crew/server... --frozen-lockfile

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN pnpm --filter @ai-crew/server prisma:generate
RUN pnpm --filter @ai-crew/server build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
