# syntax=docker/dockerfile:1.7

# ---- deps: todas as dependências (inclui dev) para compilar ----
FROM node:22-alpine AS deps
WORKDIR /app
# openssl é exigido pelo engine do Prisma no Alpine
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
# --ignore-scripts: o hook `prepare` (husky) não deve rodar dentro da imagem
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# ---- build: compila TypeScript e gera o Prisma Client ----
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---- prod-deps: somente dependências de produção ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

# ---- base-runtime: camada comum de api/collab ----
FROM node:22-alpine AS base-runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
# Prisma Client gerado no estágio build (o CLI é devDependency)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY package.json ./
COPY docker/healthcheck.js ./healthcheck.js
USER node

# ---- api: REST stateless ----
FROM base-runtime AS api
ENV API_PORT=3001 HEALTH_PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "healthcheck.js"]
CMD ["node", "dist/main.api.js"]

# ---- collab: WebSocket stateful por sala ----
FROM base-runtime AS collab
ENV COLLAB_PORT=3002 HEALTH_PORT=3002
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "healthcheck.js"]
CMD ["node", "dist/main.collab.js"]
