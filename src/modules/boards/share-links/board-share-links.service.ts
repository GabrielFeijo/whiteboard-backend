import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { redisChannels } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';
import { RedisAclEventType, Role } from '../../../shared';
import { CreateLinkDto } from '../dto/create-link.dto';
import { BoardAclService } from '../services/board-acl.service';
import {
  ShareLinkRecord,
  ShareLinksRepository,
  ShareLinkSummaryRecord,
} from './share-links.repository';

export interface CreatedShareLinkResult {
  id: string;
  boardId: string;
  token: string;
  role: Role;
  expiresAt: Date | null;
}

@Injectable()
export class BoardShareLinksService {
  constructor(
    private readonly boardAclService: BoardAclService,
    private readonly shareLinksRepository: ShareLinksRepository,
    private readonly redis: RedisService,
  ) {}

  async createShareLink(
    boardId: string,
    userId: string,
    dto: CreateLinkDto,
  ): Promise<CreatedShareLinkResult> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertCanEdit(board, 'Only editors or owners can create share links');

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = this.boardAclService.hashToken(rawToken);

    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 60 * 60 * 1000)
      : null;

    const link = await this.shareLinksRepository.create({
      boardId,
      tokenHash,
      role: dto.role ?? Role.VIEWER,
      expiresAt,
    });

    return {
      id: link.id,
      boardId: link.boardId,
      token: rawToken,
      role: link.role,
      expiresAt: link.expiresAt,
    };
  }

  async listShareLinks(boardId: string, userId: string): Promise<ShareLinkSummaryRecord[]> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    return this.shareLinksRepository.findActiveByBoard(boardId);
  }

  async revokeShareLink(boardId: string, linkId: string, userId: string): Promise<ShareLinkRecord> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertOwner(board, userId, 'Only owner can revoke links');

    const updated = await this.shareLinksRepository.revoke(boardId, linkId);

    await this.redis.client.publish(
      redisChannels.acl(boardId),
      JSON.stringify({ type: RedisAclEventType.REVOKE_LINK, linkId }),
    );

    return updated;
  }
}
