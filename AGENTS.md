# Agent Guidelines — Backend

This document guides AI agents working inside the `backend/` submodule.

## Architecture & Module Layout

The backend is built with NestJS 11 and TypeScript, designed with dual independent entrypoints to separate stateless REST API concerns from stateful real-time collaboration.

- `src/main.api.ts`: REST API entrypoint running on port 3001. Stateless. Exposes Swagger at `/v1/docs` and OpenAPI JSON at `/v1/docs-json`.
- `src/main.collab.ts`: WebSocket collaboration entrypoint running on port 3002. Stateful per active board room, validates binary Yjs updates against a shadow doc, and manages room lifecycles.
- `src/modules/auth`: Authentication with Argon2id password hashing, 15-minute access JWTs, and opaque refresh tokens in HttpOnly cookies with reuse detection.
- `src/modules/boards`: Board CRUD, RBAC authorization (OWNER, EDITOR, VIEWER), and share links.
- `src/modules/assets`: S3/MinIO presigned upload and download URLs, EXIF stripping, and magic-byte inspection.
- `src/modules/collab`: WebSocket gateway and room manager coordinating room documents and Redis pub/sub.
- `src/modules/persistence`: Debounced background worker persisting Y.Doc snapshots to PostgreSQL.
- `src/shared/`: Single source of truth for shared schemas, protocol constants, and versioning.
- `prisma/`: Database schema (`schema.prisma`), migrations, and seed scripts.
- `test/`: Unit tests, contract verification, and integration tests using Testcontainers.

## Critical Backend Rules

### 1. Dual Entrypoint Boundary
- Never add in-memory board state to `main.api.ts`.
- Never expose HTTP REST endpoints on `main.collab.ts`.
- Keep the REST API horizontally scalable and stateless.

### 2. Contract Authority
- `src/shared/` is the single source of truth for contracts between backend and frontend.
- When updating elements, schemas, or protocol messages:
  1. Modify files in `src/shared/`.
  2. Run `npx tsx scripts/gen-fixtures.ts` if protocol fixtures or schema changes require updated fixtures.
  3. Propagate changes to frontend using `make sync-shared` from the workspace root.
  4. Ensure `test/contract/shared-contract.spec.ts` passes.

### 3. Database & Migrations
- Apply schema changes via `prisma/schema.prisma`.
- Generate Prisma Client: `npm run prisma:generate`.
- Create migrations: `npm run prisma:migrate` (requires PostgreSQL running via `make deps`).
- Seed development data: `npm run db:seed`.

### 4. Verification Workflow
- Unit & contract tests: `npm run test` (runs in ~1.4s with Vitest).
- Integration tests: `npm run test:int` (uses Testcontainers; requires Docker daemon).
- Type checking: `npm run typecheck` (`tsc --noEmit`).
- Linting: `npm run lint` (`eslint .`).
