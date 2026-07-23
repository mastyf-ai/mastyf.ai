FROM node:20-alpine

WORKDIR /app
RUN addgroup -g 1001 appgroup && adduser -u 1001 -S appuser -G appgroup

COPY apps/cloud/package.json apps/cloud/tsconfig.json apps/cloud/ ./
COPY packages/ ./packages/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN corepack enable && pnpm install --frozen-lockfile --filter @mastyf_ai/cloud
RUN pnpm --filter @mastyf_ai/cloud run build

USER 1001
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "apps/cloud/.next/standalone/server.js"]
