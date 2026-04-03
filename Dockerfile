FROM node:lts AS builder
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs/package.json ./docs/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY app/ ./app/
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle/ ./drizzle/
RUN pnpm run build && CI=true pnpm prune --prod

FROM node:lts-slim
ENV NODE_ENV=production TZ=Asia/Tokyo
WORKDIR /app
COPY --from=builder /workspace/app/build ./build
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./
COPY --from=builder /workspace/drizzle ./drizzle
USER 1000
CMD ["node", "build"]
