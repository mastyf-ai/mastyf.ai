FROM node:20-alpine AS builder
WORKDIR /app

COPY . .

RUN corepack enable && pnpm install --frozen-lockfile

# Verify better-sqlite3 native prebuild (onlyBuiltDependencies in package.json)
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 prebuild OK')"

RUN cd packages/core && pnpm build
RUN cd packages/server && pnpm build
RUN npx tsc --project tsconfig.json
RUN cd packages/cli && pnpm build

FROM node:20-alpine
RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup
RUN apk add --no-cache curl su-exec
WORKDIR /app

COPY --from=builder --chown=appuser:appgroup /app/dist/ ./dist/
COPY --from=builder --chown=appuser:appgroup /app/node_modules/ ./node_modules/
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/default-policy.yaml ./default-policy.yaml
COPY --chown=appuser:appgroup docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  && mkdir -p /data && chown -R appuser:appgroup /data /app

USER 1001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/ || exit 1
EXPOSE 4000 9090
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/cli.js", "proxy"]
