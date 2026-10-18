# Claude Code Guidelines — Backend Submodule

This submodule contains the NestJS 11 backend service with dual entrypoints (Stateless REST API on :3001 and Stateful Collab WebSocket server on :3002).

See [`AGENTS.md`](./AGENTS.md) for full architecture details, module breakdown, and invariants.

## Quick Commands

- **Run Tests**: `npm run test` (Vitest unit and contract tests).
- **Integration Tests**: `npm run test:int` (Testcontainers, requires Docker).
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`).
- **Lint**: `npm run lint` (`eslint .`).
- **Prisma Client**: `npm run prisma:generate`.
- **Database Migrations**: `npm run prisma:migrate`.
- **Seed Database**: `npm run db:seed`.

## Essential Invariants

1. `src/shared/` is the single source of truth for contracts. Never edit `frontend/src/shared/` directly; make edits here and run `make sync-shared` from the repository root.
2. `src/main.api.ts` must remain completely stateless.
3. `src/main.collab.ts` manages stateful WebSocket connections and validates binary deltas against shadow documents.
4. Assets are uploaded directly via S3 Presigned URLs, never piped through WebSockets.
5. Always commit with Conventional Commits (`feat(...)`, `fix(...)`, etc.).
