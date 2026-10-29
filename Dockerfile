# syntax=docker/dockerfile:1
FROM node:lts@sha256:6d2c7d5d074bf72f81ddc252b4fbb5d625bc028eeda49cb4b8c2ff8eda1ee617 AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node.js 25以降はCorepackを同梱しない。npm側でも公開後1日の待機を適用する。
RUN npm install --global --before="$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)" corepack && \
    corepack enable pnpm
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm-workspace.yamlのpatchedDependenciesが参照する依存パッチ。無いとpnpm installが失敗する
COPY patches/ ./patches/
COPY app/package.json ./app/
COPY docs/package.json ./docs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY app/ ./app/
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle/ ./drizzle/
RUN pnpm run build && pnpm --filter @glatasks/app --prod deploy /runtime/app

FROM node:lts-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
ENV NODE_ENV=production TZ=Asia/Tokyo
WORKDIR /app/app
COPY --from=builder /runtime/app ./
COPY --from=builder /workspace/drizzle /app/drizzle
USER 1000
CMD ["node", "build"]
