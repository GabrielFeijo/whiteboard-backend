import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { BoardsService } from '../../src/boards/boards.service';

describe('BoardsService', () => {
  let service: BoardsService;
  let mockPrisma: any;
  let mockRedis: any;

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
      $transaction: vi.fn((cb) => cb(mockPrisma)),
    };
    mockRedis = {
      client: {
        set: vi.fn().mockResolvedValue('OK'),
        publish: vi.fn().mockResolvedValue(1),
      },
    };

    service = new BoardsService(mockPrisma, mockRedis);
  });

  it('creates a board and associates the creator as OWNER', async () => {
    mockPrisma.board.create.mockResolvedValue({ id: 'b1', title: 'New Board', ownerId: 'u1' });
    mockPrisma.boardMember.create.mockResolvedValue({ boardId: 'b1', userId: 'u1', role: 'OWNER' });

    const res = await service.create('u1', { title: 'New Board' });
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

    const res = await service.issueWsTicket('b1', { id: 'u1', name: 'User 1' });
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

    const res = await service.findOne('b1', 'u2', rawToken);
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

    const res = await service.findOne('b1', undefined, rawToken);
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

    await expect(service.findOne('b1', 'u2', 'invalid-token')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when accessing board without token for non-member', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [],
    });

    await expect(service.findOne('b1', 'u2')).rejects.toThrow(ForbiddenException);
  });

  it('throws UnauthorizedException when guest accesses without token', async () => {
    mockPrisma.board.findFirst.mockResolvedValue({
      id: 'b1',
      ownerId: 'u1',
      members: [],
    });

    await expect(service.findOne('b1')).rejects.toThrow(UnauthorizedException);
  });
});
