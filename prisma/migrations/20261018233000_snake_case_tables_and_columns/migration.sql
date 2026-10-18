-- Rename tables to snake_case
ALTER TABLE "User" RENAME TO "user";
ALTER TABLE "RefreshToken" RENAME TO "refresh_token";
ALTER TABLE "Board" RENAME TO "board";
ALTER TABLE "BoardMember" RENAME TO "board_member";
ALTER TABLE "ShareLink" RENAME TO "share_link";
ALTER TABLE "Snapshot" RENAME TO "snapshot";
ALTER TABLE "DocUpdate" RENAME TO "doc_update";

-- Rename columns in user
ALTER TABLE "user" RENAME COLUMN "avatarUrl" TO "avatar_url";
ALTER TABLE "user" RENAME COLUMN "passwordHash" TO "password_hash";
ALTER TABLE "user" RENAME COLUMN "failedLogins" TO "failed_logins";
ALTER TABLE "user" RENAME COLUMN "lockedUntil" TO "locked_until";
ALTER TABLE "user" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "user" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "user" RENAME COLUMN "deletedAt" TO "deleted_at";

-- Rename columns in refresh_token
ALTER TABLE "refresh_token" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "refresh_token" RENAME COLUMN "familyId" TO "family_id";
ALTER TABLE "refresh_token" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "refresh_token" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "refresh_token" RENAME COLUMN "usedAt" TO "used_at";
ALTER TABLE "refresh_token" RENAME COLUMN "revokedAt" TO "revoked_at";
ALTER TABLE "refresh_token" RENAME COLUMN "createdAt" TO "created_at";

-- Rename columns in board
ALTER TABLE "board" RENAME COLUMN "ownerId" TO "owner_id";
ALTER TABLE "board" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "board" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "board" RENAME COLUMN "deletedAt" TO "deleted_at";

-- Rename columns in board_member
ALTER TABLE "board_member" RENAME COLUMN "boardId" TO "board_id";
ALTER TABLE "board_member" RENAME COLUMN "userId" TO "user_id";

-- Rename columns in share_link
ALTER TABLE "share_link" RENAME COLUMN "boardId" TO "board_id";
ALTER TABLE "share_link" RENAME COLUMN "tokenHash" TO "token_hash";
ALTER TABLE "share_link" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "share_link" RENAME COLUMN "revokedAt" TO "revoked_at";
ALTER TABLE "share_link" RENAME COLUMN "createdAt" TO "created_at";

-- Rename columns in snapshot
ALTER TABLE "snapshot" RENAME COLUMN "boardId" TO "board_id";
ALTER TABLE "snapshot" RENAME COLUMN "createdAt" TO "created_at";

-- Rename columns in doc_update
ALTER TABLE "doc_update" RENAME COLUMN "boardId" TO "board_id";
ALTER TABLE "doc_update" RENAME COLUMN "createdAt" TO "created_at";

-- Rename constraints and indexes to match Prisma conventions
ALTER INDEX IF EXISTS "User_pkey" RENAME TO "user_pkey";
ALTER INDEX IF EXISTS "User_email_key" RENAME TO "user_email_key";
ALTER INDEX IF EXISTS "RefreshToken_pkey" RENAME TO "refresh_token_pkey";
ALTER INDEX IF EXISTS "RefreshToken_tokenHash_key" RENAME TO "refresh_token_token_hash_key";
ALTER INDEX IF EXISTS "RefreshToken_userId_idx" RENAME TO "refresh_token_user_id_idx";
ALTER INDEX IF EXISTS "RefreshToken_familyId_idx" RENAME TO "refresh_token_family_id_idx";
ALTER INDEX IF EXISTS "Board_pkey" RENAME TO "board_pkey";
ALTER INDEX IF EXISTS "Board_ownerId_idx" RENAME TO "board_owner_id_idx";
ALTER INDEX IF EXISTS "BoardMember_pkey" RENAME TO "board_member_pkey";
ALTER INDEX IF EXISTS "ShareLink_pkey" RENAME TO "share_link_pkey";
ALTER INDEX IF EXISTS "ShareLink_tokenHash_key" RENAME TO "share_link_token_hash_key";
ALTER INDEX IF EXISTS "ShareLink_boardId_idx" RENAME TO "share_link_board_id_idx";
ALTER INDEX IF EXISTS "Snapshot_pkey" RENAME TO "snapshot_pkey";
ALTER INDEX IF EXISTS "Snapshot_boardId_createdAt_idx" RENAME TO "snapshot_board_id_created_at_idx";
ALTER INDEX IF EXISTS "DocUpdate_pkey" RENAME TO "doc_update_pkey";
ALTER INDEX IF EXISTS "DocUpdate_boardId_id_idx" RENAME TO "doc_update_board_id_id_idx";

ALTER TABLE "refresh_token" RENAME CONSTRAINT "RefreshToken_userId_fkey" TO "refresh_token_user_id_fkey";
ALTER TABLE "board" RENAME CONSTRAINT "Board_ownerId_fkey" TO "board_owner_id_fkey";
ALTER TABLE "board_member" RENAME CONSTRAINT "BoardMember_boardId_fkey" TO "board_member_board_id_fkey";
ALTER TABLE "board_member" RENAME CONSTRAINT "BoardMember_userId_fkey" TO "board_member_user_id_fkey";
ALTER TABLE "share_link" RENAME CONSTRAINT "ShareLink_boardId_fkey" TO "share_link_board_id_fkey";
ALTER TABLE "snapshot" RENAME CONSTRAINT "Snapshot_boardId_fkey" TO "snapshot_board_id_fkey";
ALTER TABLE "doc_update" RENAME CONSTRAINT "DocUpdate_boardId_fkey" TO "doc_update_board_id_fkey";
