import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { BoardMembersRepository } from '../../src/modules/boards/members/board-members.repository';
import { BoardsRepository } from '../../src/modules/boards/repositories/boards.repository';
import { BoardAclService } from '../../src/modules/boards/services/board-acl.service';
import { BoardShareLinksService } from '../../src/modules/boards/share-links/board-share-links.service';
import { ShareLinksRepository } from '../../src/modules/boards/share-links/share-links.repository';

describe('BoardShareLinksService', () => {
  let service: BoardShareLinksService;
  let mockPrisma: {
    board: { findFirst: ReturnType<typeof vi.fn> };
    shareLink: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let mockRedis: {
    client: { publish: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    mockPrisma = {
      board: { findFirst: vi.fn() },
      shareLink: {
        create: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    mockRedis = {
      client: { publish: vi.fn().mockResolvedValue(1) },
    };

    const prismaService = mockPrisma as unknown as PrismaService;
    const redisService = mockRedis as unknown as RedisService;

    const boardsRepo = new BoardsRepository(prismaService);
    const membersRepo = new BoardMembersRepository(prismaService);
    const linksRepo = new ShareLinksRepository(prismaService);
    const aclService = new BoardAclService(boardsRepo, membersRepo, linksRepo);

    service = new BoardShareLinksService(aclService, linksRepo, redisService);
  });

  it('allows owner or editor to generate share link with hash and optional expiration', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });

    mockPrisma.shareLink.create.mockImplementation((args: { data: Record<string, unknown> }) => ({
      id: 'link-123',
      boardId: args.data.boardId,
      tokenHash: args.data.tokenHash,
      role: args.data.role,
      expiresAt: args.data.expiresAt,
    }));

    const result = await service.createShareLink('b1', 'u1', {
      role: 'EDITOR',
      expiresInHours: 24,
    });

    expect(result.id).toBe('link-123');
    expect(result.boardId).toBe('b1');
    expect(result.role).toBe('EDITOR');
    expect(result.token).toBeDefined();
    expect(result.expiresAt).toBeInstanceOf(Date);

    const expectedHash = crypto.createHash('sha256').update(result.token).digest('hex');
    expect(mockPrisma.shareLink.create).toHaveBeenCalledWith({
      data: {
        boardId: 'b1',
        tokenHash: expectedHash,
        role: 'EDITOR',
        expiresAt: expect.any(Date),
      },
    });
  });

  it('rejects share link creation if user is only a VIEWER', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u2', role: 'VIEWER' }],
    });

    await expect(service.createShareLink('b1', 'u2', { role: 'VIEWER' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lists active share links for members', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });

    mockPrisma.shareLink.findMany.mockResolvedValue([
      { id: 'l1', role: 'VIEWER', createdAt: new Date(), expiresAt: null },
    ]);

    const list = await service.listShareLinks('b1', 'u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('l1');
  });

  it('revokes a share link when requested by OWNER and publishes Redis ACL event', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });

    mockPrisma.shareLink.update.mockResolvedValue({
      id: 'l1',
      boardId: 'b1',
      revokedAt: new Date(),
    });

    const revoked = await service.revokeShareLink('b1', 'l1', 'u1');
    expect(revoked.id).toBe('l1');
    expect(mockPrisma.shareLink.update).toHaveBeenCalledWith({
      where: { id: 'l1', boardId: 'b1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockRedis.client.publish).toHaveBeenCalledWith(
      'board:b1:acl',
      JSON.stringify({ type: 'REVOKE_LINK', linkId: 'l1' }),
    );
  });

  it('rejects share link revocation if caller is not the OWNER', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u2', role: 'EDITOR' }],
    });

    await expect(service.revokeShareLink('b1', 'l1', 'u2')).rejects.toThrow(ForbiddenException);
  });
});
