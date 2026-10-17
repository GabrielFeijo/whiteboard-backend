import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

export interface SnapshotRecord {
  id: string;
  boardId: string;
  version: number;
  reason: string;
  createdAt: Date;
  data: Uint8Array | Buffer;
}

@Injectable()
export class SnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestByBoard(boardId: string): Promise<SnapshotRecord | null> {
    return this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestByVersion(boardId: string): Promise<{ id: string; version: number } | null> {
    return this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { version: 'desc' },
    });
  }

  async findByIdAndBoard(snapshotId: string, boardId: string): Promise<SnapshotRecord | null> {
    return this.prisma.snapshot.findFirst({
      where: { id: snapshotId, boardId },
    });
  }

  async findManyByBoard(boardId: string, take = 50): Promise<SnapshotRecord[]> {
    return this.prisma.snapshot.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        boardId: true,
        version: true,
        reason: true,
        createdAt: true,
        data: true,
      },
    });
  }

  async create(data: {
    boardId: string;
    data: Uint8Array | Buffer;
    version: number;
    reason: string;
  }): Promise<SnapshotRecord> {
    return this.prisma.snapshot.create({
      data: {
        boardId: data.boardId,
        data: Buffer.from(data.data),
        version: data.version,
        reason: data.reason,
      },
    });
  }
}
