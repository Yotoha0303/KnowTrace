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

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

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
