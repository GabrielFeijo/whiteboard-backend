import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../../core/database/prisma.service';

export interface SnapshotRecord {
  id: string;
  boardId: string;
  version: number;
  reason: string;
  createdAt: Date;
  data: Uint8Array | Buffer;
}

const SNAPSHOT_SELECT = {
  id: true,
  boardId: true,
  version: true,
  reason: true,
  createdAt: true,
  data: true,
} as const;

@Injectable()
export class SnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestByBoard(boardId: string): Promise<SnapshotRecord | null> {
    return this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      select: SNAPSHOT_SELECT,
    });
  }

  async findLatestByVersion(boardId: string): Promise<{ id: string; version: number } | null> {
    return this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
  }

  async findByIdAndBoard(snapshotId: string, boardId: string): Promise<SnapshotRecord | null> {
    return this.prisma.snapshot.findFirst({
      where: { id: snapshotId, boardId },
      select: SNAPSHOT_SELECT,
    });
  }

  async findManyByBoard(boardId: string, take = 50): Promise<SnapshotRecord[]> {
    return this.prisma.snapshot.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take,
      select: SNAPSHOT_SELECT,
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
      select: SNAPSHOT_SELECT,
    });
  }

  async loadMergedBoardState(boardId: string): Promise<Uint8Array | undefined> {
    const latestSnapshot = await this.findLatestByBoard(boardId);
    const updates =
      (await this.prisma.docUpdate?.findMany({
        where: {
          boardId,
          ...(latestSnapshot ? { createdAt: { gt: latestSnapshot.createdAt } } : {}),
        },
        orderBy: { id: 'asc' },
      })) ?? [];

    const chunks: Uint8Array[] = [];
    if (latestSnapshot?.data) {
      chunks.push(new Uint8Array(latestSnapshot.data));
    }
    for (const row of updates) {
      chunks.push(new Uint8Array(row.data));
    }

    if (chunks.length === 0) {
      return undefined;
    }
    if (chunks.length === 1) {
      return chunks[0];
    }
    return Y.mergeUpdates(chunks);
  }
}
