import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PersistenceService implements OnModuleInit, OnModuleDestroy {
  private buffer = new Map<string, Uint8Array[]>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => {
      this.flushAll().catch(console.error);
    }, 500);
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushAll();
  }

  queueUpdate(boardId: string, update: Uint8Array) {
    let list = this.buffer.get(boardId);
    if (!list) {
      list = [];
      this.buffer.set(boardId, list);
    }
    list.push(update);

    if (list.length >= 50) {
      this.flushBoard(boardId).catch(console.error);
    }
  }

  private async flushBoard(boardId: string) {
    const updates = this.buffer.get(boardId);
    if (!updates || updates.length === 0) return;
    this.buffer.delete(boardId);

    const data = updates.map((u) => ({
      boardId,
      data: Buffer.from(u),
    }));

    await this.prisma.docUpdate.createMany({ data });
  }

  async flushAll() {
    const boardIds = Array.from(this.buffer.keys());
    await Promise.all(boardIds.map((id) => this.flushBoard(id)));
  }

  async saveSnapshot(boardId: string, snapshotBytes: Uint8Array, reason = 'AUTO'): Promise<void> {
    await this.flushBoard(boardId);

    const latest = await this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const snap = await this.prisma.snapshot.create({
      data: {
        boardId,
        data: Buffer.from(snapshotBytes),
        version,
        reason,
      },
    });

    // Compact: delete doc updates that occurred before the snapshot timestamp
    await this.prisma.docUpdate.deleteMany({
      where: {
        boardId,
        createdAt: { lte: snap.createdAt },
      },
    });
  }

  async loadInitialState(boardId: string): Promise<{ snapshot: Uint8Array | null; updates: Uint8Array[] }> {
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
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
