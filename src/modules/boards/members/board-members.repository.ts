import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { Role } from '../../../shared';

export interface BoardMemberWithUserRecord {
  boardId: string;
  userId: string;
  role: Role;
  user?: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

@Injectable()
export class BoardMembersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async enrollUser(boardId: string, userId: string, role: Role): Promise<void> {
    await this.prisma.boardMember.upsert({
      where: {
        boardId_userId: { boardId, userId },
      },
      create: {
        boardId,
        userId,
        role,
      },
      update: {
        role,
      },
    });
  }

  async upsertMemberWithUser(
    boardId: string,
    userId: string,
    role: Role,
  ): Promise<BoardMemberWithUserRecord> {
    return this.prisma.boardMember.upsert({
      where: {
        boardId_userId: { boardId, userId },
      },
      create: {
        boardId,
        userId,
        role,
      },
      update: {
        role,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
  }

  async findAllByBoard(boardId: string): Promise<BoardMemberWithUserRecord[]> {
    return this.prisma.boardMember.findMany({
      where: { boardId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
      orderBy: { role: 'asc' },
    });
  }

  async removeMember(
    boardId: string,
    memberUserId: string,
  ): Promise<{ boardId: string; userId: string; role: Role }> {
    return this.prisma.boardMember.delete({
      where: {
        boardId_userId: { boardId, userId: memberUserId },
      },
    });
  }
}
