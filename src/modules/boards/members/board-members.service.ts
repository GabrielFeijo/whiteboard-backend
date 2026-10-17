import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { redisChannels } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';
import { RedisAclEventType, Role } from '../../../shared';
import { UsersRepository } from '../../users/users.repository';
import { AddMemberDto } from '../dto/add-member.dto';
import { BoardAclService } from '../services/board-acl.service';
import { BoardMembersRepository, BoardMemberWithUserRecord } from './board-members.repository';

@Injectable()
export class BoardMembersService {
  constructor(
    private readonly boardAclService: BoardAclService,
    private readonly boardMembersRepository: BoardMembersRepository,
    private readonly usersRepository: UsersRepository,
    private readonly redis: RedisService,
  ) {}

  async addMember(
    boardId: string,
    userId: string,
    dto: AddMemberDto,
  ): Promise<BoardMemberWithUserRecord> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertOwner(board, userId, 'Only owner can add members directly');

    const email = dto.email.toLowerCase().trim();
    const targetUser = await this.usersRepository.findByEmail(email);

    if (!targetUser || (targetUser.deletedAt !== undefined && targetUser.deletedAt !== null)) {
      throw new NotFoundException('User not found with this email');
    }

    if (targetUser.id === board.ownerId) {
      throw new BadRequestException('User is already the board owner');
    }

    return this.boardMembersRepository.upsertMemberWithUser(boardId, targetUser.id, dto.role);
  }

  async listMembers(boardId: string, userId: string): Promise<BoardMemberWithUserRecord[]> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    return this.boardMembersRepository.findAllByBoard(boardId);
  }

  async removeMember(
    boardId: string,
    memberUserId: string,
    userId: string,
  ): Promise<{ boardId: string; userId: string; role: Role }> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertOwner(board, userId, 'Only owner can remove members');

    if (memberUserId === board.ownerId) {
      throw new BadRequestException('Cannot remove board owner');
    }

    const removed = await this.boardMembersRepository.removeMember(boardId, memberUserId);

    await this.redis.client.publish(
      redisChannels.acl(boardId),
      JSON.stringify({ type: RedisAclEventType.REMOVE_MEMBER, userId: memberUserId }),
    );

    return removed;
  }
}
