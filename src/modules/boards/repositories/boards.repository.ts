import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { Role, SnapshotReason } from '../../../shared';

export interface BoardRecord {
  id: string;
  title: string;
  ownerId: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export interface BoardListEntryRecord extends BoardRecord {
  members: Array<{ role: Role }>;
  _count: { members: number };
}

export interface BoardDetailRecord extends BoardRecord {
  owner?: { id: string; name: string; email: string };
  members: Array<{
    boardId?: string;
    userId: string;
    role: Role;
    user?: { id: string; name: string; email: string; avatarUrl: string | null };
  }>;
}

@Injectable()
export class BoardsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWithOwner(userId: string, title: string): Promise<BoardRecord> {
    return this.prisma.$transaction(async (tx) => {
      const board = await tx.board.create({
        data: {
          title,
          ownerId: userId,
        },
      });

      await tx.boardMember.create({
        data: {
          boardId: board.id,
          userId,
          role: Role.OWNER,
        },
      });

      return board;
    });
  }

  async findManyPaginated(
    userId: string,
    take: number,
    cursor?: string,
  ): Promise<BoardListEntryRecord[]> {
    return this.prisma.board.findMany({
      where: {
        deletedAt: null,
        members: {
          some: { userId },
        },
      },
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: {
          select: { members: true },
        },
      },
    });
  }

  async findByIdWithMembers(boardId: string): Promise<BoardDetailRecord | null> {
    return this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        },
      },
    });
  }

  async findByIdForUserMember(boardId: string, userId: string): Promise<BoardDetailRecord | null> {
    return this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: {
        members: { where: { userId } },
      },
    });
  }

  async updateTitle(boardId: string, title: string): Promise<BoardRecord> {
    return this.prisma.board.update({
      where: { id: boardId },
      data: { title },
    });
  }

  async duplicateWithSnapshot(
    originalTitle: string,
    userId: string,
    snapshotData?: Uint8Array | Buffer,
  ): Promise<BoardRecord> {
    return this.prisma.$transaction(async (tx) => {
      const duplicated = await tx.board.create({
        data: {
          title: `Copy of ${originalTitle}`,
          ownerId: userId,
        },
      });

      await tx.boardMember.create({
        data: {
          boardId: duplicated.id,
          userId,
          role: Role.OWNER,
        },
      });

      if (snapshotData) {
        await tx.snapshot.create({
          data: {
            boardId: duplicated.id,
            data: Buffer.from(snapshotData),
            version: 1,
            reason: SnapshotReason.MANUAL,
          },
        });
      }

      return duplicated;
    });
  }

  async softDelete(boardId: string): Promise<BoardRecord> {
    return this.prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date() },
    });
  }

  async purgeExpiredSoftDeleted(retentionDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.board.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lt: cutoff,
        },
      },
    });
    return result.count;
  }
}
