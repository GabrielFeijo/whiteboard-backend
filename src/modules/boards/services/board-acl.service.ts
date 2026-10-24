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
      return Role.OWNER;
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

    const directRole = userId ? this.resolveDirectMemberRole(board, userId) : undefined;

    if (!shareToken) {
      return this.handleDirectBoardAccess(board, directRole, userId);
    }

    return this.handleShareTokenBoardAccess(board, shareToken, directRole, userId);
  }

  private handleDirectBoardAccess(
    board: BoardDetailRecord,
    directRole?: Role,
    userId?: string,
  ): ResolvedBoardWithRole {
    if (directRole) {
      return {
        ...board,
        role: directRole,
        currentUserRole: directRole,
      };
    }

    if (userId) {
      throw new ForbiddenException('Access denied to board');
    }

    throw new UnauthorizedException('Authentication or share link required');
  }

  private async handleShareTokenBoardAccess(
    board: BoardDetailRecord,
    shareToken: string,
    directRole?: Role,
    userId?: string,
  ): Promise<ResolvedBoardWithRole> {
    const { effectiveRole, linkId } = await this.resolveShareLinkAndEnroll({
      boardId: board.id,
      ownerId: board.ownerId,
      shareToken,
      directRole,
      userId,
    });

    return {
      ...board,
      role: effectiveRole,
      currentUserRole: effectiveRole,
      resolvedLinkId: linkId,
    };
  }

  async resolveShareLinkAndEnroll(params: {
    boardId: string;
    ownerId: string;
    shareToken: string;
    directRole?: Role;
    userId?: string;
  }): Promise<{ effectiveRole: Role; linkId: string }> {
    const link = await this.validateShareLink(params.boardId, params.shareToken);
    const effectiveRole = this.resolveEffectiveRole(params.directRole, link.role);

    if (params.userId && params.ownerId !== params.userId && params.directRole !== effectiveRole) {
      await this.boardMembersRepository.enrollUser(params.boardId, params.userId, effectiveRole);
    }

    return { effectiveRole, linkId: link.id };
  }

  resolveEffectiveRole(directRole?: Role, linkRole: Role = Role.VIEWER): Role {
    if (directRole === Role.OWNER) {
      return Role.OWNER;
    }
    if (linkRole === Role.EDITOR || directRole === Role.EDITOR) {
      return Role.EDITOR;
    }
    return linkRole;
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
    if (board.ownerId !== userId && board.currentUserRole !== Role.OWNER) {
      throw new ForbiddenException(message);
    }
  }

  assertCanEdit(board: { currentUserRole: Role }, message: string): void {
    if (board.currentUserRole !== Role.OWNER && board.currentUserRole !== Role.EDITOR) {
      throw new ForbiddenException(message);
    }
  }
}
