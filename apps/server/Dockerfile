FROM node:22-slim AS base
WORKDIR /repo
RUN corepack enable
# 러너타임과 빌드 양쪽 모두 필요 (Prisma 쿼리 엔진이 libssl에 동적 링크됨).
# 여기서 설치해야 런타임 스테이지(base에서 새로 시작)에도 남는다.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

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
RUN pnpm --filter @ai-crew/shared build
RUN pnpm --filter @ai-crew/server prisma:generate
RUN pnpm --filter @ai-crew/server build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/server
EXPOSE 8080
CMD ["node", "dist/index.js"]
