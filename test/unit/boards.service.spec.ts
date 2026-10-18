import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/core/database/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { BoardMembersRepository } from '../../src/modules/boards/members/board-members.repository';
import { BoardMembersService } from '../../src/modules/boards/members/board-members.service';
import { BoardsRepository } from '../../src/modules/boards/repositories/boards.repository';
import { BoardAclService } from '../../src/modules/boards/services/board-acl.service';
import { BoardsService } from '../../src/modules/boards/services/boards.service';
import { ShareLinksRepository } from '../../src/modules/boards/share-links/share-links.repository';
import { SnapshotsRepository } from '../../src/modules/boards/snapshots/snapshots.repository';
import { BoardWsTicketService } from '../../src/modules/boards/ws-ticket/board-ws-ticket.service';
import { UsersRepository } from '../../src/modules/users/users.repository';

interface MockBoardsPrisma {
  board: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  boardMember: {
    create: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  shareLink: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  snapshot: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

interface MockBoardsRedis {
  client: {
    set: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
}

describe('Boards Domain Services (BoardsService, BoardMembersService, BoardWsTicketService)', () => {
  let boardsService: BoardsService;
  let boardMembersService: BoardMembersService;
  let boardWsTicketService: BoardWsTicketService;
  let mockPrisma: MockBoardsPrisma;
  let mockRedis: MockBoardsRedis;

  beforeEach(() => {
    mockPrisma = {
      board: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      boardMember: {
        create: vi.fn(),
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn(),
        delete: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      shareLink: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      snapshot: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn((cb: (tx: MockBoardsPrisma) => unknown) => cb(mockPrisma)),
    };
    mockRedis = {
      client: {
        set: vi.fn().mockResolvedValue('OK'),
        publish: vi.fn().mockResolvedValue(1),
      },
    };

    const prismaService = mockPrisma as unknown as PrismaService;
    const redisService = mockRedis as unknown as RedisService;

    const boardsRepository = new BoardsRepository(prismaService);
    const boardMembersRepository = new BoardMembersRepository(prismaService);
    const shareLinksRepository = new ShareLinksRepository(prismaService);
    const snapshotsRepository = new SnapshotsRepository(prismaService);
    const usersRepository = new UsersRepository(prismaService);

    const boardAclService = new BoardAclService(
      boardsRepository,
      boardMembersRepository,
      shareLinksRepository,
    );

    boardsService = new BoardsService(boardsRepository, snapshotsRepository, boardAclService);
    boardMembersService = new BoardMembersService(
      boardAclService,
      boardMembersRepository,
      usersRepository,
      redisService,
    );
    boardWsTicketService = new BoardWsTicketService(
      boardsRepository,
      boardMembersRepository,
      boardAclService,
      redisService,
    );
  });

  it('creates a board and associates the creator as OWNER', async () => {
    mockPrisma.board.create.mockResolvedValue({ id: 'b1', title: 'New Board', ownerId: 'u1' });
    mockPrisma.boardMember.create.mockResolvedValue({ boardId: 'b1', userId: 'u1', role: 'OWNER' });

    const res = await boardsService.create('u1', { title: 'New Board' });
    expect(res.id).toBe('b1');
    expect(mockPrisma.board.create).toHaveBeenCalledOnce();
    expect(mockPrisma.boardMember.create).toHaveBeenCalledWith({
      data: { boardId: 'b1', userId: 'u1', role: 'OWNER' },
    });
  });

  it('generates a 30s single-use WS ticket in Redis for an authorized member', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      deletedAt: null,
      members: [{ userId: 'u1', role: 'OWNER' }],
    });

    const res = await boardWsTicketService.issueWsTicket('b1', { id: 'u1', name: 'User 1' });
    expect(res.ticket).toMatch(/^wst_/);
    expect(res.role).toBe('OWNER');
    expect(mockRedis.client.set).toHaveBeenCalledWith(
      expect.stringContaining('ws:ticket:'),
      expect.any(String),
      'EX',
      30,
    );
  });

  it('allows another user to access board via valid share token and enrolls member', async () => {
    const rawToken = 'test-token-123';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      title: 'Shared Board',
      ownerId: 'u1',
      members: [],
    });

    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'link1',
      boardId: 'b1',
      tokenHash,
      role: 'EDITOR',
      revokedAt: null,
      expiresAt: null,
    });

    const res = await boardsService.findOne('b1', 'u2', rawToken);
    expect(res.role).toBe('EDITOR');
    expect(mockPrisma.boardMember.upsert).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: 'b1', userId: 'u2' } },
      create: { boardId: 'b1', userId: 'u2', role: 'EDITOR' },
      update: { role: 'EDITOR' },
    });
  });

  it('allows anonymous guest to access board with valid share token', async () => {
    const rawToken = 'test-token-guest';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      title: 'Guest Board',
      ownerId: 'u1',
      members: [],
    });

    mockPrisma.shareLink.findUnique.mockResolvedValue({
      id: 'link1',
      boardId: 'b1',
      tokenHash,
      role: 'VIEWER',
      revokedAt: null,
      expiresAt: null,
    });

    const res = await boardsService.findOne('b1', undefined, rawToken);
    expect(res.role).toBe('VIEWER');
    expect(mockPrisma.boardMember.upsert).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException on invalid or revoked share token', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [],
    });
    mockPrisma.shareLink.findUnique.mockResolvedValue(null);

    await expect(boardsService.findOne('b1', 'u2', 'invalid-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when accessing board without token for non-member', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u3', role: 'EDITOR' }],
    });

    await expect(boardsService.findOne('b1', 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when guest accesses without token', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [],
    });

    await expect(boardsService.findOne('b1')).rejects.toThrow(UnauthorizedException);
  });

  it('adds a member directly by email when requested by owner', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u2',
      email: 'u2@example.com',
      name: 'User 2',
      deletedAt: null,
    });
    mockPrisma.boardMember.upsert.mockResolvedValue({
      boardId: 'b1',
      userId: 'u2',
      role: 'EDITOR',
      user: { id: 'u2', name: 'User 2', email: 'u2@example.com', avatarUrl: null },
    });

    const res = await boardMembersService.addMember('b1', 'u1', {
      email: 'u2@example.com',
      role: 'EDITOR',
    });
    expect(res.userId).toBe('u2');
    expect(res.role).toBe('EDITOR');
    expect(mockPrisma.boardMember.upsert).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: 'b1', userId: 'u2' } },
      create: { boardId: 'b1', userId: 'u2', role: 'EDITOR' },
      update: { role: 'EDITOR' },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
  });

  it('lists members of the board', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });
    mockPrisma.boardMember.findMany.mockResolvedValue([
      { boardId: 'b1', userId: 'u1', role: 'OWNER' },
      { boardId: 'b1', userId: 'u2', role: 'EDITOR' },
    ]);

    const res = await boardMembersService.listMembers('b1', 'u1');
    expect(res).toHaveLength(2);
  });

  it('removes a member when requested by owner and publishes REMOVE_MEMBER on Redis ACL channel', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [{ userId: 'u1', role: 'OWNER' }],
    });
    mockPrisma.boardMember.delete.mockResolvedValue({
      boardId: 'b1',
      userId: 'u2',
      role: 'EDITOR',
    });

    await boardMembersService.removeMember('b1', 'u2', 'u1');
    expect(mockPrisma.boardMember.delete).toHaveBeenCalledWith({
      where: { boardId_userId: { boardId: 'b1', userId: 'u2' } },
    });
    expect(mockRedis.client.publish).toHaveBeenCalledWith(
      'board:b1:acl',
      JSON.stringify({ type: 'REMOVE_MEMBER', userId: 'u2' }),
    );
  });

  it('paginates boards with cursor and sets nextCursor to the last item of the page', async () => {
    mockPrisma.board.findMany.mockResolvedValue([
      { id: 'b1', title: 'Board 1', ownerId: 'u1', members: [{ role: 'OWNER' }], _count: { members: 1 } },
      { id: 'b2', title: 'Board 2', ownerId: 'u1', members: [{ role: 'OWNER' }], _count: { members: 1 } },
      { id: 'b3', title: 'Board 3', ownerId: 'u1', members: [{ role: 'OWNER' }], _count: { members: 1 } },
    ]);

    const res = await boardsService.findAll('u1', undefined, 2);
    expect(res.items).toHaveLength(2);
    expect(res.items.map((i) => i.id)).toEqual(['b1', 'b2']);
    expect(res.nextCursor).toBe('b2');
  });

  it('returns null nextCursor when items do not exceed limit', async () => {
    mockPrisma.board.findMany.mockResolvedValue([
      { id: 'b1', title: 'Board 1', ownerId: 'u1', members: [{ role: 'OWNER' }], _count: { members: 1 } },
    ]);

    const res = await boardsService.findAll('u1', undefined, 2);
    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).toBeNull();
  });
});
