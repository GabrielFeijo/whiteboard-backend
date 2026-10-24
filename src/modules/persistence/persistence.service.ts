import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Y from 'yjs';
import { PrismaService } from '../../core/database/prisma.service';
import { SnapshotReason } from '../../shared';

@Injectable()
export class PersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersistenceService.name);
  private readonly buffer = new Map<string, Uint8Array[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      this.flushAll().catch((err: unknown) => {
        this.logger.error('Scheduled flushAll failed', err);
      });
    }, 500);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushAll();
  }

  queueUpdate(boardId: string, update: Uint8Array): void {
    let list = this.buffer.get(boardId);
    if (!list) {
      list = [];
      this.buffer.set(boardId, list);
    }
    list.push(update);

    if (list.length >= 50) {
      this.flushBoard(boardId).catch((err: unknown) => {
        this.logger.error(`Immediate buffer flush failed for board ${boardId}`, err);
      });
    }
  }

  async flushBoard(boardId: string): Promise<void> {
    const updates = this.buffer.get(boardId);
    if (!updates || updates.length === 0) return;
    this.buffer.delete(boardId);

    const merged = updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);
    const data = [
      {
        boardId,
        data: Buffer.from(merged),
      },
    ];

    try {
      await this.prisma.docUpdate.createMany({ data });
    } catch (err) {
      const concurrent = this.buffer.get(boardId) ?? [];
      this.buffer.set(boardId, [...updates, ...concurrent]);
      throw err;
    }
  }

  async flushAll(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      const boardIds = Array.from(this.buffer.keys());
      await Promise.all(boardIds.map((id) => this.flushBoard(id)));
    } finally {
      this.isFlushing = false;
    }
  }

  async saveSnapshot(
    boardId: string,
    snapshotBytes: Uint8Array,
    reason: SnapshotReason = SnapshotReason.AUTO,
  ): Promise<void> {
    await this.flushBoard(boardId);

    const executeSave = async (client: PrismaService): Promise<void> => {
      const latest = await client.snapshot.findFirst({
        where: { boardId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;

      const snap = await client.snapshot.create({
        data: {
          boardId,
          data: Buffer.from(snapshotBytes),
          version,
          reason,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      await client.docUpdate.deleteMany({
        where: {
          boardId,
          createdAt: { lte: snap.createdAt },
        },
      });
    };

    if (typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction(async (tx) => {
        await executeSave(tx as unknown as PrismaService);
      });
      return;
    }

    await executeSave(this.prisma);
  }

  async loadInitialState(
    boardId: string,
  ): Promise<{ snapshot: Uint8Array | null; updates: Uint8Array[] }> {
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        data: true,
      },
    });

    const updates = await this.prisma.docUpdate.findMany({
      where: {
        boardId,
        createdAt: snapshot ? { gt: snapshot.createdAt } : undefined,
      },
      orderBy: { id: 'asc' },
    });

    return {
      snapshot: snapshot ? new Uint8Array(snapshot.data) : null,
      updates: updates.map((u) => new Uint8Array(u.data)),
    };
  }
}
