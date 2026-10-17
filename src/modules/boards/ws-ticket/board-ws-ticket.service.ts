import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nanoid } from 'nanoid';
import { Env } from '../../../core/config/env';
import { redisKeys } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';
import { LIMITS, Role } from '../../../shared';
import { BoardMembersRepository } from '../members/board-members.repository';
import { BoardsRepository } from '../repositories/boards.repository';
import { BoardAclService } from '../services/board-acl.service';

export interface IssuedWsTicketResult {
  ticket: string;
  role: Role;
  boardId: string;
  userId: string;
  userName: string;
  linkId?: string;
}

@Injectable()
export class BoardWsTicketService {
  constructor(
    private readonly boardsRepository: BoardsRepository,
    private readonly boardMembersRepository: BoardMembersRepository,
    private readonly boardAclService: BoardAclService,
    private readonly redis: RedisService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  async issueWsTicket(
    boardId: string,
    user?: { id: string; name: string },
    linkToken?: string,
  ): Promise<IssuedWsTicketResult> {
    let resolvedRole: Role = 'VIEWER';
    let resolvedUserId = user ? user.id : '';
    let resolvedName = user ? user.name : 'Anonymous Guest';
    let resolvedLinkId: string | undefined;

    if (user) {
      const board = await this.boardsRepository.findByIdForUserMember(boardId, user.id);

      if (!board) {
        throw new NotFoundException('Board not found');
      }

      const directRole = this.boardAclService.resolveDirectMemberRole(board, user.id);
      if (directRole) {
        resolvedRole = directRole;
      } else if (!linkToken) {
        throw new ForbiddenException('Access denied to board');
      }
    }

    if (linkToken) {
      const link = await this.boardAclService.validateShareLink(boardId, linkToken);
      resolvedLinkId = link.id;

      if (!user || resolvedRole === 'VIEWER' || link.role === 'EDITOR') {
        if (resolvedRole !== 'OWNER') {
          resolvedRole = link.role;
        }
      }

      if (!user) {
        resolvedUserId = `guest_${nanoid(8)}`;
        resolvedName = `Guest ${resolvedUserId.slice(-4)}`;
      } else if (resolvedRole !== 'OWNER') {
        await this.boardMembersRepository.enrollUser(boardId, user.id, resolvedRole);
      }
    }

    if (!resolvedUserId) {
      throw new BadRequestException('Authentication or share link required');
    }

    const ticket = `wst_${nanoid(32)}`;
    const ticketPayload = JSON.stringify({
      userId: resolvedUserId,
      userName: resolvedName,
      boardId,
      role: resolvedRole,
      ...(resolvedLinkId ? { linkId: resolvedLinkId } : {}),
    });

    const ttlSeconds =
      this.config?.get('WS_TICKET_TTL', { infer: true }) ?? LIMITS.WS_TICKET_TTL_SECONDS;

    await this.redis.client.set(redisKeys.wsTicket(ticket), ticketPayload, 'EX', ttlSeconds);

    return {
      ticket,
      role: resolvedRole,
      boardId,
      userId: resolvedUserId,
      userName: resolvedName,
      ...(resolvedLinkId ? { linkId: resolvedLinkId } : {}),
    };
  }
}
