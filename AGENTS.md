# Agent Guidelines — Backend Submodule

This document establishes operational standards, architectural invariants, code quality rules, and commit conventions for all human engineers and autonomous AI agents working inside the `backend/` submodule.

---

## 🏛️ Architecture & Module Breakdown

The backend is built with **NestJS 11** and **TypeScript**, engineered with a **dual independent entrypoint** architecture to strictly isolate stateless REST API concerns from stateful real-time collaboration.

### Dual Entrypoints
- `src/main.api.ts`: REST API entrypoint running on port 3001. Stateless. Exposes Swagger at `/v1/docs` and OpenAPI JSON at `/v1/docs-json`.
- `src/main.collab.ts`: WebSocket collaboration entrypoint running on port 3002. Stateful per active board room, validates binary Yjs updates against an authoritative shadow doc, and coordinates multi-pod replication via Redis.

### Domain Modules
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
  - `schema.prisma`: Data models mapped to PostgreSQL `snake_case` tables (`user`, `refresh_token`, `board`, `board_member`, `share_link`, `snapshot`, `doc_update`).
  - Migrations in `prisma/migrations/`.
  - Development seed scripts in `prisma/seed.ts`.

---

## 🚫 Prohibited Comments & Documentation Standards

1. **No AI/Model Signatures**: Never add comments stating that code was generated, modified, or recommended by an AI assistant.
2. **No Dead Commented Code**: Never leave unused or commented-out code blocks. Use Git version control for history.
3. **No Redundant Comments**: Do not write comments that merely rephrase the immediate code statement (e.g., `// Save user to database` before `await this.prisma.user.create(...)`).
4. **No Unanchored TODOs**: Never leave untracked `// TODO` comments.
5. **Language Requirement**: All comments, docstrings, and commits must be authored in **English**.

---

## 🛑 Prohibited Backend Code Smells & Antipatterns

1. **Type Safety Smells**:
   - Never use `any` or `as any`. Use strict typing, generics, or validate unknown inputs with Zod.
   - Never use `@ts-ignore` or `@ts-nocheck`. Fix type errors at the interface level.
2. **Stateless / Stateful Boundary Smells**:
   - Never store in-memory board state, active rooms, or Yjs documents in `main.api.ts`.
   - Never register HTTP REST endpoints in `main.collab.ts`.
3. **Security & Validation Smells**:
   - Never bypass the Shadow Document validator when accepting incoming Yjs deltas.
   - Never expose raw database IDs or credentials in log output or error responses.
   - Never throw raw strings or generic untyped errors; use NestJS HTTP exceptions (`BadRequestException`, `ForbiddenException`, etc.).
4. **Database & Query Smells**:
   - Never introduce N+1 query patterns; use Prisma relational `include` or explicit batch queries.
   - Never perform unindexed queries on large tables (`doc_update`, `snapshot`, `board_member`).
   - Never introduce Prisma models or fields without explicit `snake_case` database mapping (`@@map("table_name")` and `@map("column_name")`).
5. **WebSocket Asset Smells**:
   - Never transfer binary file payloads over the collaborative WebSocket channel. Assets must always be uploaded directly via S3 Presigned PUT URLs.

---

## 📦 Commit Message Standardization

All commits inside `backend/` must strictly follow Conventional Commits:

```
<type>(<scope>): <subject in lowercase imperative mood>
```

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
- **Backend Scopes**: `auth`, `boards`, `collab`, `assets`, `persistence`, `prisma`, `shared`, `observability`.
- **Examples**:
  - `feat(collab): add debounced update merging worker`
  - `fix(auth): prevent race condition in atomic refresh token rotation`
  - `refactor(boards): extract share link verification into guard`

---

## 🛠️ Verification Workflow

Before committing in `backend/`, verify that all quality gates pass:

```bash
# Run unit & contract tests (Vitest)
npm run test

# Run TypeScript typecheck (tsc --noEmit)
npm run typecheck

# Run ESLint
npm run lint

# If shared contracts changed, verify parity from root:
make sync-shared-check
```
