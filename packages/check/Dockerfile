# Mastyf check service (free tier) for servers.
# Build from the repository root:  docker build -f packages/check/Dockerfile -t mastyf-check .
# Run:  docker run -e MASTYF_CHECK_TOKEN=<32+ characters> -p 127.0.0.1:4100:4100 mastyf-check
# Publish the port only to the network your agent runs on.

FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @mastyf_ai/check --ignore-scripts \
 && cd packages/check && node esbuild.mjs

FROM node:22-alpine
LABEL org.opencontainers.image.title="mastyf-check" \
      org.opencontainers.image.description="Mastyf's free checks for AI agents' tool calls and results" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/mastyf-ai/mastyf.ai"
WORKDIR /app
COPY --from=build /repo/packages/check/dist/mastyf-check.cjs /app/mastyf-check.cjs
USER node
ENV MASTYF_CHECK_HOST=0.0.0.0 \
    MASTYF_CHECK_PORT=4100 \
    NODE_ENV=production
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4100/v1/health >/dev/null || exit 1
# Refuses to start without MASTYF_CHECK_TOKEN, since it listens beyond 127.0.0.1 inside the container.
ENTRYPOINT ["node", "/app/mastyf-check.cjs"]
CMD ["serve", "--log", "json"]
