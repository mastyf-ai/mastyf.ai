# Pinned digest for reproducible builds (see docs/SUPPLY_CHAIN.md)
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app

# better-sqlite3 prebuild fallback needs native toolchain on alpine
# netcat-openbsd used by entrypoint for Redis health check
RUN apk add --no-cache python3 make g++ netcat-openbsd \
  && ln -sf /usr/bin/python3 /usr/bin/python

COPY . .

RUN corepack enable && pnpm install --frozen-lockfile

# Verify better-sqlite3 native prebuild (onlyBuiltDependencies in package.json)
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 prebuild OK')"

RUN pnpm --filter @mastyf-ai/plugin-sdk run build
RUN cd packages/core && pnpm build
RUN cd packages/server && pnpm build
RUN npx tsc --project tsconfig.json
RUN cd packages/cli && pnpm build

# Copy non-TS assets that tsc doesn't handle:
# - SQL migration files the migration-runner reads at runtime from dist/
# - The regex eval worker (ES module loaded dynamically)
# - Redis Lua scripts
RUN mkdir -p dist/database/migrations dist/policy dist/scripts/redis \
  && cp src/database/migrations/*.sql dist/database/migrations/ \
  && cp src/policy/regex-eval-worker.mjs dist/policy/ \
  && cp scripts/redis/*.lua dist/scripts/redis/

# Build the Next.js dashboard SPA (static export → deploy/dashboard-spa/out/)
# NODE_ENV must be production so next.config.ts enables output:'export'
RUN NODE_ENV=production pnpm --filter @mastyf-ai/dashboard-spa run build

# Adversarial harness Python venv for swarm parity gates (run.mjs --fast)
RUN cd adversarial-harness \
  && python3 -m venv .venv \
  && ./.venv/bin/python3 -m pip install -q -r python/requirements.txt || true

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
# pnpm/vitest/corpus + adversarial-harness parity for dashboard Security Swarm
RUN apk add --no-cache curl su-exec python3 make g++ git \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && corepack enable
WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/dist/ ./dist/
COPY --from=builder --chown=appuser:appgroup /app/node_modules/ ./node_modules/
COPY --from=builder --chown=appuser:appgroup /app/packages/ ./packages/
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/pnpm-lock.yaml ./
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json ./
COPY --from=builder --chown=appuser:appgroup /app/vitest.config.ts ./
COPY --from=builder --chown=appuser:appgroup /app/vitest.harness.config.ts ./
COPY --from=builder --chown=appuser:appgroup /app/vitest.workspace-aliases.ts ./
COPY --from=builder --chown=appuser:appgroup /app/default-policy.yaml ./default-policy.yaml
COPY --from=builder --chown=appuser:appgroup /app/corpus/ ./corpus/
COPY --from=builder --chown=appuser:appgroup /app/tests/ ./tests/
COPY --from=builder --chown=appuser:appgroup /app/adversarial-harness/ ./adversarial-harness/
# Copy the built dashboard SPA so dashboard-server.ts finds it at deploy/dashboard-spa/out/
COPY --from=builder --chown=appuser:appgroup /app/deploy/dashboard-spa/out/ ./deploy/dashboard-spa/out/
# Dashboard-triggered Threat Lab / swarm jobs (tsx scripts import from src/)
COPY --from=builder --chown=appuser:appgroup /app/security-swarm/ ./security-swarm/
COPY --from=builder --chown=appuser:appgroup /app/scripts/security-swarm/ ./scripts/security-swarm/
COPY --from=builder --chown=appuser:appgroup /app/scenarios/ ./scenarios/
COPY --from=builder --chown=appuser:appgroup /app/src/ ./src/
COPY --chown=appuser:appgroup deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip Windows CRLF line endings so the shebang works on Linux
# regardless of how Git checked out the file on the build machine.
RUN sed -i 's/\r//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data /app/reports /app/test-results && chown -R appuser:appgroup /data /app /app/reports /app/test-results

USER 1001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/ || exit 1
EXPOSE 4000 9090
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV PATH="/app/node_modules/.bin:${PATH}"
ENV MASTYF_AI_DB_PATH=/data/history.db
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/cli.js", "proxy"]
