# Agent Guidelines — Backend

This document guides AI agents working inside the `backend/` submodule.

## Architecture & Module Layout

The backend is built with NestJS 11 and TypeScript, designed with dual independent entrypoints to separate stateless REST API concerns from stateful real-time collaboration.

### Entrypoints
- `src/main.api.ts`: REST API entrypoint running on port 3001. Stateless. Exposes Swagger at `/v1/docs` and OpenAPI JSON at `/v1/docs-json`.
- `src/main.collab.ts`: WebSocket collaboration entrypoint running on port 3002. Stateful per active board room, validates binary Yjs updates against a shadow doc, and manages room lifecycles.

### Modules Breakdown
- `src/modules/auth/`:
  - Password hashing with Argon2id.
  - 15-minute access JWTs.
  - Opaque refresh tokens stored in HttpOnly cookies with atomic rotation and family reuse detection.
  - IP + Email composite brute-force lockout via Redis.
- `src/modules/boards/`:
  - Board CRUD operations and ownership management.
  - RBAC authorization guards (`OWNER`, `EDITOR`, `VIEWER`).
  - Share links with SHA-256 hashed tokens, role assignments, and expiration.
  - Collab ticket generation (`POST /v1/boards/:id/collab-token`).
- `src/modules/assets/`:
  - S3 / MinIO presigned PUT upload URLs and presigned GET download URLs.
  - Dual-endpoint rewrite: internally connects to `S3_ENDPOINT` (e.g. `http://minio:9000`), presigned URLs rewrite to `S3_PUBLIC_ENDPOINT` (e.g. `http://localhost:9000`).
  - Strict MIME validation, magic-byte inspection, and asset ownership checks.
- `src/modules/collab/`:
  - WebSocket gateway (`/collab`) handling real-time binary synchronization.
  - `RoomManagerService`: In-memory `Y.Doc` sessions per active room.
  - Shadow document validation: Validates all incoming Yjs deltas using Zod schemas (`ElementDataSchema`), ensuring elements cannot exceed boundaries or violate 5,000 element cap.
  - Redis Pub/Sub integration: Multi-pod delta broadcasting via `board:{id}:updates` and instant ACL kick propagation via `board:{id}:acl`.
- `src/modules/persistence/`:
  - Debounced background worker persisting room updates to PostgreSQL.
  - Buffer batches of updates (500ms or 50 updates) and merges them using `Y.mergeUpdates`.
  - Snapshot compaction preventing delta log explosion.
  - Origin isolation: Uses `'init'` tag when hydrating from DB to prevent re-triggering persistence loops.
- `src/modules/observability/`:
  - Health checks: `/health/live` (liveness) and `/health/ready` (database, redis, and disk checks).
  - Prometheus metrics exported at `/metrics`.
- `src/shared/`:
  - **Single source of truth** for shared schemas, Zod validators, element types, error codes, and protocol constants.
- `prisma/`:
  - `schema.prisma`: Data models (`User`, `RefreshToken`, `Board`, `BoardMember`, `BoardShareLink`, `BoardSnapshot`, `BoardUpdate`, `BoardAsset`).
  - Migrations in `prisma/migrations/`.
  - Development seed scripts in `prisma/seed.ts`.

---

## Critical Backend Rules & Invariants

### 1. Dual Entrypoint Boundary
- **NEVER add in-memory board state to `main.api.ts`.**
- **NEVER expose HTTP REST endpoints on `main.collab.ts`.**
- The REST API must remain 100% stateless so it can be horizontally scaled behind a load balancer without sticky sessions.
- The Collab Server is stateful and uses Redis Pub/Sub to synchronize across pods.

### 2. Contract Authority
- `src/shared/` is the authoritative source for contracts between backend and frontend.
- When updating elements, schemas, or protocol messages:
  1. Modify files in `src/shared/`.
  2. If protocol fixtures or schema changes require updated fixtures, run:
     `npx tsx scripts/gen-fixtures.ts`
  3. Propagate changes to frontend using `make sync-shared` from the workspace root.
  4. Ensure `test/contract/shared-contract.spec.ts` passes.

### 3. Database & Migrations
- Apply schema changes via `prisma/schema.prisma`.
- Generate Prisma Client: `npm run prisma:generate`.
- Create migrations: `npm run prisma:migrate` (requires PostgreSQL running via `make deps`).
- Seed development data: `npm run db:seed`.
- When deleting boards or users, ensure foreign key cascades and S3 asset cleanup are handled.

### 4. Verification Workflow
- Unit & contract tests: `npm run test` (runs with Vitest).
- Integration tests: `npm run test:int` (uses Testcontainers; requires Docker daemon).
- Type checking: `npm run typecheck` (`tsc --noEmit`).
- Linting: `npm run lint` (`eslint .`).

### 5. Git Submodule Protocol
- Always commit inside `backend/` first following Conventional Commits (`feat(...)`, `fix(...)`, `docs(...)`, etc.).
- Never commit broken TypeScript or failing tests; husky pre-commit hooks enforce lint and typecheck.
