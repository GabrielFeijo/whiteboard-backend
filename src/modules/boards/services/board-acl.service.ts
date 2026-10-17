import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { BoardAclResolver } from '../../../common/guards/board-access.guard';
import { BoardAccessContext } from '../../../common/types/express-request.interface';
import { Role } from '../../../shared';
import { BoardMembersRepository } from '../members/board-members.repository';
import { BoardDetailRecord, BoardsRepository } from '../repositories/boards.repository';
import { ShareLinkRecord, ShareLinksRepository } from '../share-links/share-links.repository';

export interface ResolvedBoardWithRole extends BoardDetailRecord {
  role: Role;
  currentUserRole: Role;
  resolvedLinkId?: string;
}

@Injectable()
export class BoardAclService implements BoardAclResolver {
  constructor(
    private readonly boardsRepository: BoardsRepository,
    private readonly boardMembersRepository: BoardMembersRepository,
    private readonly shareLinksRepository: ShareLinksRepository,
  ) {}

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async validateShareLink(boardId: string, token: string): Promise<ShareLinkRecord> {
    const tokenHash = this.hashToken(token);
    const link = await this.shareLinksRepository.findByTokenHash(tokenHash);

    if (!link || link.boardId !== boardId || link.revokedAt !== null) {
      throw new ForbiddenException('Invalid or revoked share link');
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenException('Share link has expired');
    }

    return link;
  }

  resolveDirectMemberRole(
    board: { ownerId: string; members: Array<{ userId: string; role: Role }> },
    userId: string,
  ): Role | undefined {
    if (board.ownerId === userId) {
      return 'OWNER';
    }
    return board.members.find((m) => m.userId === userId)?.role;
  }

  async resolveBoardWithAccess(
    boardId: string,
    userId?: string,
    shareToken?: string,
  ): Promise<ResolvedBoardWithRole> {
    const board = await this.boardsRepository.findByIdWithMembers(boardId);

    if (!board) {
      throw new NotFoundException('Board not found');
    }

    let userRole: Role | undefined = userId
      ? this.resolveDirectMemberRole(board, userId)
      : undefined;
    let resolvedLinkId: string | undefined;

    if (shareToken) {
      const link = await this.validateShareLink(boardId, shareToken);
      resolvedLinkId = link.id;
      if (!userRole || (userRole === 'VIEWER' && link.role === 'EDITOR')) {
        userRole = link.role;
      }
      if (userId && board.ownerId !== userId) {
        await this.boardMembersRepository.enrollUser(boardId, userId, userRole);
      }
    } else if (!userRole) {
      if (userId) {
        throw new ForbiddenException('Access denied to board');
      }
      throw new UnauthorizedException('Authentication or share link required');
    }

    return {
      ...board,
      role: userRole,
      currentUserRole: userRole,
      resolvedLinkId,
    };
  }

  async resolveBoardAccess(
    boardId: string,
    userId?: string,
    shareToken?: string,
  ): Promise<BoardAccessContext> {
    const board = await this.resolveBoardWithAccess(boardId, userId, shareToken);
    return {
      boardId: board.id,
      title: board.title,
      ownerId: board.ownerId,
      role: board.currentUserRole,
      isAnonymous: !userId,
      linkId: board.resolvedLinkId,
    };
  }

  assertOwner(
    board: { ownerId: string; currentUserRole: Role },
    userId: string,
    message: string,
  ): void {
    if (board.ownerId !== userId && board.currentUserRole !== 'OWNER') {
      throw new ForbiddenException(message);
    }
  }

  assertCanEdit(board: { currentUserRole: Role }, message: string): void {
    if (board.currentUserRole !== 'OWNER' && board.currentUserRole !== 'EDITOR') {
      throw new ForbiddenException(message);
    }
  }
}
