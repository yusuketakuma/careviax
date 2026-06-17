# syntax=docker/dockerfile:1

FROM node:24.16.0-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ARG APP_ENV=production
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_placeholder
ARG NEXT_PUBLIC_COGNITO_CLIENT_ID=placeholder-client-id
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG DIRECT_URL=postgresql://build:build@localhost:5432/build
ARG NEXTAUTH_URL=http://localhost:3000
ARG NEXTAUTH_SECRET=build-time-placeholder-secret
ARG AUTH_SECRET=build-time-placeholder-secret
ARG ENCRYPTION_KEY=YnVpbGQtdGltZS1wbGFjZWhvbGRlci0zMmJ5dGVzLTEyMw==
ARG JWT_SIGNING_SECRET=build-time-placeholder-jwt-secret
ARG AWS_REGION=ap-northeast-1
ENV APP_ENV=$APP_ENV
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_COGNITO_USER_POOL_ID=$NEXT_PUBLIC_COGNITO_USER_POOL_ID
ENV NEXT_PUBLIC_COGNITO_CLIENT_ID=$NEXT_PUBLIC_COGNITO_CLIENT_ID
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_URL=$DIRECT_URL
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET
ENV AUTH_SECRET=$AUTH_SECRET
ENV ENCRYPTION_KEY=$ENCRYPTION_KEY
ENV JWT_SIGNING_SECRET=$JWT_SIGNING_SECRET
ENV AWS_REGION=$AWS_REGION
COPY . .
RUN pnpm build
RUN rm -f .next/standalone/.env .next/standalone/.env.*

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((res) => { if (!res.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "server.js"]
