/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BoardsService } from '../../src/boards/boards.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

describe('BoardsService - Snapshots & Restore', () => {
  it('lists historical snapshots for a board member', async () => {
    const mockPrisma = {
      board: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'b1',
          ownerId: 'u1',
          members: [{ role: 'EDITOR', userId: 'u2' }],
        }),
      },
      snapshot: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 's1',
            boardId: 'b1',
            version: 1,
            reason: 'AUTO',
            createdAt: new Date(),
            data: Buffer.from([1, 2, 3]),
          },
        ]),
      },
    } as unknown as PrismaService;

    const mockRedis = {
      client: { publish: vi.fn() },
    } as unknown as RedisService;

    const service = new BoardsService(mockPrisma, mockRedis);
    const snapshots = await service.listSnapshots('b1', 'u2');

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].id).toBe('s1');
    expect(snapshots[0].size).toBe(3);
  });

  it('rejects restore if user is a VIEWER', async () => {
    const mockPrisma = {
      board: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'b1',
          ownerId: 'u1',
          members: [{ role: 'VIEWER', userId: 'u3' }],
        }),
      },
    } as unknown as PrismaService;

    const service = new BoardsService(mockPrisma, {} as any);

    await expect(service.restoreSnapshot('b1', 's1', 'u3')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('restores snapshot and publishes event to Redis for OWNER', async () => {
    const publishSpy = vi.fn().mockResolvedValue(1);
    const mockRedis = {
      client: { publish: publishSpy },
    } as unknown as RedisService;

    const mockPrisma = {
      board: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'b1',
          ownerId: 'u1',
          members: [{ role: 'OWNER', userId: 'u1' }],
        }),
      },
      snapshot: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 's1',
            boardId: 'b1',
            version: 1,
            data: Buffer.from([10, 20]),
          })
          .mockResolvedValueOnce({
            id: 's2',
            boardId: 'b1',
            version: 2,
          }),
        create: vi.fn().mockResolvedValue({
          id: 's3',
          boardId: 'b1',
          version: 3,
          reason: 'RESTORED_FROM_V1',
          createdAt: new Date(),
        }),
      },
    } as unknown as PrismaService;

    const service = new BoardsService(mockPrisma, mockRedis);
    const res = await service.restoreSnapshot('b1', 's1', 'u1');

    expect(res.success).toBe(true);
    expect(res.version).toBe(3);
    expect(publishSpy).toHaveBeenCalledWith(
      'board:b1:restore',
      expect.stringContaining('s1'),
    );
  });

  it('throws NotFoundException if target snapshot does not exist', async () => {
    const mockPrisma = {
      board: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'b1',
          ownerId: 'u1',
          members: [{ role: 'OWNER', userId: 'u1' }],
        }),
      },
      snapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const service = new BoardsService(mockPrisma, { client: { publish: vi.fn() } } as any);

    await expect(service.restoreSnapshot('b1', 'nonexistent', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
