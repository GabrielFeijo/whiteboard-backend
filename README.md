# Whiteboard — Backend

API REST (stateless) e Collab Server (WebSocket, stateful por sala) do whiteboard colaborativo.
Stack: NestJS 11, Yjs + `y-protocols`, Prisma 6, PostgreSQL, Redis, S3/MinIO.

> Repositório **independente** do frontend. O contrato entre os dois vive em `src/shared/` e
> `fixtures/protocol/` — **este repo é a fonte da verdade** (veja `docs/adr/ADR-000` na pasta raiz).

## Requisitos
Node 22+, npm 10+, Docker (para Postgres/Redis/MinIO).

## Desenvolvimento
```bash
cp .env.example .env
# dependências (na pasta raiz do workspace):  make deps    (Postgres :5442, Redis :6379, MinIO :9000/:9001)
npm ci
npx prisma migrate dev
npm run start:api:dev      # http://localhost:3001  (docs: /v1/docs)
npm run start:collab:dev   # ws://localhost:3002
```

## Scripts
| Script | Função |
| --- | --- |
| `npm run lint` / `typecheck` / `test` | Qualidade e testes unitários + contrato |
| `npm run test:int` | Integração (Testcontainers/serviços reais) |
| `npm run build` | Compila `dist/` (`main.api.js`, `main.collab.js`) |
| `npm run prisma:migrate` / `prisma:deploy` | Migrations (dev / produção) |
| `npx tsx scripts/gen-fixtures.ts` | Regenera `fixtures/protocol/*.json` |

## Contrato com o frontend
Ao alterar `src/shared/*`:
1. Incremente `SHARED_VERSION` (e `SCHEMA_VERSION`/`PROTOCOL_VERSION` se incompatível).
2. `npx tsx scripts/gen-fixtures.ts` e `npm test`.
3. No frontend: `npm run sync:shared` e `npm test`.

## Docker
`docker/Dockerfile` é multi-stage com alvos `api` e `collab`:
```bash
docker build -f docker/Dockerfile --target api -t wb-api .
docker build -f docker/Dockerfile --target collab -t wb-collab .
```

## Endpoints atuais (fundação)
`GET /health/live`, `GET /health/ready` (Postgres + Redis), `GET /v1/docs`, `GET /v1/docs-json`.
