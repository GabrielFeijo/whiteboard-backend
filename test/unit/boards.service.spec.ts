import { describe, expect, it, vi, beforeEach } from 'vitest';
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
});
