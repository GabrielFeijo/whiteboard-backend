# Claude Code Guidelines — Backend Submodule

This submodule contains the NestJS 11 backend service with dual entrypoints (Stateless REST API on :3001 and Stateful Collab WebSocket server on :3002).

See [`AGENTS.md`](./AGENTS.md) for full architecture details, module breakdown, code quality rules, and invariants.

## Quick Commands

- **Run Tests**: `npm run test` (Vitest unit and contract tests).
- **Integration Tests**: `npm run test:int` (Testcontainers, requires Docker).
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`).
- **Lint**: `npm run lint` (`eslint .`).
- **Prisma Client**: `npm run prisma:generate`.
- **Database Migrations**: `npm run prisma:migrate`.
- **Seed Database**: `npm run db:seed`.

## Essential Invariants & Code Standards

1. **Contracts Authority**: `src/shared/` is the single source of truth for contracts. Never edit `frontend/src/shared/` directly; make edits here and run `make sync-shared` from the repository root.
2. **Stateless API Boundary**: `src/main.api.ts` must remain completely stateless.
3. **Collab Server Boundary**: `src/main.collab.ts` manages stateful WebSocket connections and validates binary deltas against shadow documents.
4. **S3 Direct Uploads**: Assets are uploaded directly via S3 Presigned URLs, never piped through WebSockets.
5. **No AI Signatures or Dead Code**: Never add comments referring to AI models or user requests. Never leave blocks of commented-out dead code.
6. **No Code Smells**: Never use `any` or `@ts-ignore`. Never swallow errors in empty catch blocks. Never introduce unindexed database queries or N+1 patterns.
7. **Conventional Commits**: Always commit with Conventional Commits (`feat(...)`, `fix(...)`, etc.) in lowercase imperative mood.
8. **English Language**: All documentation, code comments, and commit messages must be in English.
