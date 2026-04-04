ARG NODE_IMAGE=node:20
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
RUN npm run db:generate

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=4744

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm run db:generate && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/QUESTION.md ./QUESTION.md

# Runtime writable directories for generated artifacts.
RUN mkdir -p /app/storage/imports /app/storage/outputs

EXPOSE 4744
CMD ["npm", "run", "start"]
