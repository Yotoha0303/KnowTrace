FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js evaluates server modules while collecting route metadata. The value is
# only a build-time placeholder; Compose supplies the real runtime connection.
ENV DATABASE_URL="postgres://knowtrace:knowtrace@postgres:5432/knowtrace"
# 把构建时的 git revision 烘进镜像（不是运行时注入）。
# 为什么必须是构建时：运行态版本核对要比对「镜像里装的是哪一版代码」。
# 若改成运行时 env 注入，重建与不重建会得到同一个值，核对就失去意义 ——
# 2026-09-30 修正过一次这个设计，原委见 docs/16-stage3-observability.md「运行态版本核对」。
# 允许为空（例如从 tarball 构建）：metrics 里会显示 "unknown"。
ARG KNOWTRACE_APP_REVISION=unknown
ENV KNOWTRACE_APP_REVISION=$KNOWTRACE_APP_REVISION

# 构建内存上限。宿主机是 2 vCPU / ~1.8GB，next build 在默认堆上限下容易被
# OOM killer 杀掉（见 docs/2026-09-29-一键部署可行性与设计.md 记录的 OOM 事件）。
# 给一个明确上限，让它在被杀之前先自己失败并留下可读错误，而不是把整机拖进 swap 抖动。
# 只在 builder 阶段设置 —— runner 阶段不继承，运行时不受影响。
ARG NODE_OPTIONS=--max-old-space-size=1024
ENV NODE_OPTIONS=$NODE_OPTIONS

RUN pnpm build
RUN pnpm exec esbuild scripts/migrate.mjs \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=/app/migrate.bundle.mjs
RUN pnpm exec esbuild scripts/maintenance.mjs \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=/app/maintenance.bundle.mjs

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
# 与 builder 同一个构建参数：runner 阶段不会自动继承 builder 的 ENV，
# 必须在这里再声明一次，否则容器里是空的。
ARG KNOWTRACE_APP_REVISION=unknown
ENV KNOWTRACE_APP_REVISION=$KNOWTRACE_APP_REVISION

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data/uploads/evidence \
  && chown -R nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Next standalone traces only the CommonJS half of this pnpm package, while
# the runtime also imports its ESM exports. Merge the complete helper package.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers ./node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/migrate.bundle.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/maintenance.bundle.mjs ./scripts/maintenance.mjs
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3000

CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/maintenance.mjs && node server.js"]
