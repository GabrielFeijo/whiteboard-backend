import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../../src/shared';
import { BoardAclService } from '../../src/modules/boards/services/board-acl.service';
import { BoardWsTicketService } from '../../src/modules/boards/ws-ticket/board-ws-ticket.service';
import { BoardDetailRecord, BoardsRepository } from '../../src/modules/boards/repositories/boards.repository';
import { BoardMembersRepository } from '../../src/modules/boards/members/board-members.repository';
import { ShareLinkRecord, ShareLinksRepository } from '../../src/modules/boards/share-links/share-links.repository';
import { RedisService } from '../../src/core/redis/redis.service';
import { ConfigService } from '@nestjs/config';

import { Env } from '../../src/core/config/env';

describe('Board Access Control & Security ACL Audit', () => {
  let aclService: BoardAclService;
  let wsTicketService: BoardWsTicketService;

  const mockBoardsRepository = {
    findByIdWithMembers: vi.fn(),
    findByIdForUserMember: vi.fn(),
  } as unknown as BoardsRepository;

  const mockBoardMembersRepository = {
    enrollUser: vi.fn(),
  } as unknown as BoardMembersRepository;

  const mockShareLinksRepository = {
    findByTokenHash: vi.fn(),
  } as unknown as ShareLinksRepository;

  const mockRedisClient = {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
  };

  const mockRedisService = {
    client: mockRedisClient,
  } as unknown as RedisService;

  const mockConfigService = {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'WS_TICKET_TTL') return 30;
      if (key === 'WS_COLLAB_URL') return 'ws://localhost:3002/collab';
      return undefined;
    }),
  } as unknown as ConfigService<Env, true>;

  beforeEach(() => {
    vi.clearAllMocks();
    aclService = new BoardAclService(
      mockBoardsRepository,
      mockBoardMembersRepository,
      mockShareLinksRepository,
    );
    wsTicketService = new BoardWsTicketService(
      mockBoardsRepository,
      aclService,
      mockRedisService,
      mockConfigService,
    );
  });

  const baseBoard: BoardDetailRecord = {
    id: 'board-alpha',
    title: 'Secret Architecture Board',
    ownerId: 'user-alice-owner',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    owner: { id: 'user-alice-owner', name: 'Alice Owner', email: 'alice@example.com' },
    members: [
      {
        boardId: 'board-alpha',
        userId: 'user-bob-editor',
        role: Role.EDITOR,
        user: { id: 'user-bob-editor', name: 'Bob Editor', email: 'bob@example.com', avatarUrl: null },
      },
      {
        boardId: 'board-alpha',
        userId: 'user-carol-viewer',
        role: Role.VIEWER,
        user: { id: 'user-carol-viewer', name: 'Carol Viewer', email: 'carol@example.com', avatarUrl: null },
      },
    ],
  };

  describe('Board Direct Access Control', () => {
    it('allows board owner full OWNER access', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValueOnce(baseBoard);

      const resolved = await aclService.resolveBoardWithAccess('board-alpha', 'user-alice-owner');

      expect(resolved.id).toBe('board-alpha');
      expect(resolved.currentUserRole).toBe(Role.OWNER);
      expect(resolved.role).toBe(Role.OWNER);
    });

    it('allows enrolled editor EDITOR access', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValueOnce(baseBoard);

      const resolved = await aclService.resolveBoardWithAccess('board-alpha', 'user-bob-editor');

      expect(resolved.currentUserRole).toBe(Role.EDITOR);
      expect(resolved.role).toBe(Role.EDITOR);
    });

    it('allows enrolled viewer VIEWER access', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValueOnce(baseBoard);

      const resolved = await aclService.resolveBoardWithAccess('board-alpha', 'user-carol-viewer');

      expect(resolved.currentUserRole).toBe(Role.VIEWER);
      expect(resolved.role).toBe(Role.VIEWER);
    });

    it('throws ForbiddenException (403) when an unauthorized stranger tries to access private board', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValue(baseBoard);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'stranger-mallory-id'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'stranger-mallory-id'),
      ).rejects.toThrow('Access denied to board');
    });

    it('throws UnauthorizedException (401) when an unauthenticated guest tries to access private board without token', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValue(baseBoard);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', undefined),
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', undefined),
      ).rejects.toThrow('Authentication or share link required');
    });

    it('throws NotFoundException (404) when requested board does not exist', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValue(null);

      await expect(
        aclService.resolveBoardWithAccess('nonexistent-id', 'user-alice-owner'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        aclService.resolveBoardWithAccess('nonexistent-id', 'user-alice-owner'),
      ).rejects.toThrow('Board not found');
    });
  });

  describe('Share Token Validation & Security', () => {
    const getValidShareLink = (): ShareLinkRecord => ({
      id: 'link-valid-1',
      boardId: 'board-alpha',
      tokenHash: aclService.hashToken('raw-token-123'),
      role: Role.EDITOR,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60), // +1 hour
      revokedAt: null,
      createdAt: new Date(),
    });

    it('allows valid share token and enrolls new user with link role', async () => {
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValueOnce(baseBoard);
      vi.mocked(mockShareLinksRepository.findByTokenHash).mockResolvedValueOnce(getValidShareLink());

      const resolved = await aclService.resolveBoardWithAccess(
        'board-alpha',
        'new-user-david',
        'raw-token-123',
      );

      expect(resolved.currentUserRole).toBe(Role.EDITOR);
      expect(resolved.resolvedLinkId).toBe('link-valid-1');
      expect(mockBoardMembersRepository.enrollUser).toHaveBeenCalledWith(
        'board-alpha',
        'new-user-david',
        Role.EDITOR,
      );
    });

    it('throws ForbiddenException when share token has been revoked', async () => {
      const revokedLink: ShareLinkRecord = {
        ...getValidShareLink(),
        revokedAt: new Date(),
      };
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValue(baseBoard);
      vi.mocked(mockShareLinksRepository.findByTokenHash).mockResolvedValue(revokedLink);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'new-user-david', 'raw-token-123'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'new-user-david', 'raw-token-123'),
      ).rejects.toThrow('Invalid or revoked share link');
    });

    it('throws ForbiddenException when share token has expired', async () => {
      const expiredLink: ShareLinkRecord = {
        ...getValidShareLink(),
        expiresAt: new Date(Date.now() - 1000 * 60), // -1 min expired
      };
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValue(baseBoard);
      vi.mocked(mockShareLinksRepository.findByTokenHash).mockResolvedValue(expiredLink);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'new-user-david', 'raw-token-123'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'new-user-david', 'raw-token-123'),
      ).rejects.toThrow('Share link has expired');
    });

    it('throws ForbiddenException when share token belongs to a completely different board', async () => {
      const otherBoardLink: ShareLinkRecord = {
        ...getValidShareLink(),
        boardId: 'different-board-id',
      };
      vi.mocked(mockBoardsRepository.findByIdWithMembers).mockResolvedValueOnce(baseBoard);
      vi.mocked(mockShareLinksRepository.findByTokenHash).mockResolvedValueOnce(otherBoardLink);

      await expect(
        aclService.resolveBoardWithAccess('board-alpha', 'new-user-david', 'raw-token-123'),
      ).rejects.toThrow('Invalid or revoked share link');
    });
  });

  describe('Role-Based Invariant Assertions', () => {
    it('assertOwner throws ForbiddenException for non-owner users', () => {
      const board = { ownerId: 'user-alice-owner', currentUserRole: Role.EDITOR };

      expect(() =>
        aclService.assertOwner(board, 'user-bob-editor', 'Only the board owner can delete it'),
      ).toThrow(ForbiddenException);

      expect(() =>
        aclService.assertOwner(board, 'user-bob-editor', 'Only the board owner can delete it'),
      ).toThrow('Only the board owner can delete it');
    });

    it('assertOwner succeeds when userId matches ownerId', () => {
      const board = { ownerId: 'user-alice-owner', currentUserRole: Role.OWNER };

      expect(() =>
        aclService.assertOwner(board, 'user-alice-owner', 'Only the board owner can delete it'),
      ).not.toThrow();
    });

    it('assertCanEdit throws ForbiddenException for viewers', () => {
      const board = { currentUserRole: Role.VIEWER };

      expect(() =>
        aclService.assertCanEdit(board, 'Viewers cannot rename board'),
      ).toThrow(ForbiddenException);

      expect(() =>
        aclService.assertCanEdit(board, 'Viewers cannot rename board'),
      ).toThrow('Viewers cannot rename board');
    });

    it('assertCanEdit succeeds for editors and owners', () => {
      expect(() =>
        aclService.assertCanEdit({ currentUserRole: Role.EDITOR }, 'Viewers cannot edit'),
      ).not.toThrow();

      expect(() =>
        aclService.assertCanEdit({ currentUserRole: Role.OWNER }, 'Viewers cannot edit'),
      ).not.toThrow();
    });
  });

  describe('WebSocket Collab Ticket Security', () => {
    it('rejects ticket creation with 403 Forbidden when unauthorized stranger attempts to connect', async () => {
      vi.mocked(mockBoardsRepository.findByIdForUserMember).mockResolvedValue(baseBoard);

      await expect(
        wsTicketService.issueWsTicket('board-alpha', { id: 'stranger-mallory', name: 'Mallory Stranger' }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        wsTicketService.issueWsTicket('board-alpha', { id: 'stranger-mallory', name: 'Mallory Stranger' }),
      ).rejects.toThrow('Access denied to board');
    });

    it('issues ticket with correct role for authorized member', async () => {
      vi.mocked(mockBoardsRepository.findByIdForUserMember).mockResolvedValue(baseBoard);
      mockRedisClient.set.mockResolvedValue('OK');

      const result = await wsTicketService.issueWsTicket('board-alpha', {
        id: 'user-bob-editor',
        name: 'Bob Editor',
      });

      expect(result.ticket).toBeDefined();
      expect(result.role).toBe(Role.EDITOR);
      expect(result.boardId).toBe('board-alpha');
      expect(result.userId).toBe('user-bob-editor');
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('user-bob-editor'),
        'EX',
        30,
      );
    });
  });
});
