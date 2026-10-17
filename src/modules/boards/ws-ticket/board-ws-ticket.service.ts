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

interface ResolvedTicketIdentity {
  role: Role;
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
    if (!user && !linkToken) {
      throw new BadRequestException('Authentication or share link required');
    }

    const identity = user
      ? await this.resolveUserTicketIdentity(boardId, user, linkToken)
      : await this.resolveGuestTicketIdentity(boardId, linkToken!);

    const ticket = `wst_${nanoid(32)}`;
    const ticketPayload = JSON.stringify({
      userId: identity.userId,
      userName: identity.userName,
      boardId,
      role: identity.role,
      ...(identity.linkId ? { linkId: identity.linkId } : {}),
    });

    const ttlSeconds =
      this.config?.get('WS_TICKET_TTL', { infer: true }) ?? LIMITS.WS_TICKET_TTL_SECONDS;

    await this.redis.client.set(redisKeys.wsTicket(ticket), ticketPayload, 'EX', ttlSeconds);

    return {
      ticket,
      role: identity.role,
      boardId,
      userId: identity.userId,
      userName: identity.userName,
      ...(identity.linkId ? { linkId: identity.linkId } : {}),
    };
  }

  private async resolveGuestTicketIdentity(
    boardId: string,
    linkToken: string,
  ): Promise<ResolvedTicketIdentity> {
    const link = await this.boardAclService.validateShareLink(boardId, linkToken);
    const guestId = `guest_${nanoid(8)}`;
    return {
      role: link.role,
      userId: guestId,
      userName: `Guest ${guestId.slice(-4)}`,
      linkId: link.id,
    };
  }

  private async resolveUserTicketIdentity(
    boardId: string,
    user: { id: string; name: string },
    linkToken?: string,
  ): Promise<ResolvedTicketIdentity> {
    const board = await this.boardsRepository.findByIdForUserMember(boardId, user.id);
    if (!board) {
      throw new NotFoundException('Board not found');
    }

    const directRole = this.boardAclService.resolveDirectMemberRole(board, user.id);
    if (!directRole && !linkToken) {
      throw new ForbiddenException('Access denied to board');
    }

    if (!linkToken) {
      return {
        role: directRole ?? Role.VIEWER,
        userId: user.id,
        userName: user.name,
      };
    }

    const link = await this.boardAclService.validateShareLink(boardId, linkToken);
    const effectiveRole = this.computeEffectiveRole(directRole, link.role);

    if (effectiveRole !== Role.OWNER) {
      await this.boardMembersRepository.enrollUser(boardId, user.id, effectiveRole);
    }

    return {
      role: effectiveRole,
      userId: user.id,
      userName: user.name,
      linkId: link.id,
    };
  }

  private computeEffectiveRole(directRole?: Role, linkRole: Role = Role.VIEWER): Role {
    if (directRole === Role.OWNER) {
      return Role.OWNER;
    }
    if (linkRole === Role.EDITOR || directRole === Role.EDITOR) {
      return Role.EDITOR;
    }
    return linkRole;
  }
}
