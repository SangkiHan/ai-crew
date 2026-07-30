FROM node:22-slim AS base
WORKDIR /repo
RUN corepack enable

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY runner/package.json runner/package.json
RUN pnpm install --filter @ai-crew/web... --frozen-lockfile

FROM deps AS build
COPY apps/web apps/web
RUN pnpm --filter @ai-crew/web build

FROM nginx:alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
