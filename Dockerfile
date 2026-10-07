# syntax=docker/dockerfile:1
FROM node:lts AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/
COPY docs/package.json ./docs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY app/ ./app/
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle/ ./drizzle/
RUN pnpm run build && pnpm --filter @glatasks/app --prod deploy /runtime/app

FROM node:lts-slim
ENV NODE_ENV=production TZ=Asia/Tokyo
WORKDIR /app/app
COPY --from=builder /runtime/app ./
COPY --from=builder /workspace/drizzle /app/drizzle
USER 1000
CMD ["node", "build"]
