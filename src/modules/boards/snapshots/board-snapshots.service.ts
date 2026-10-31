import { Injectable, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { redisChannels } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';
import { SnapshotReason } from '../../../shared';
import { BoardAclService } from '../services/board-acl.service';
import { SnapshotRecord, SnapshotsRepository } from './snapshots.repository';

export interface SnapshotListItem {
  id: string;
  boardId: string;
  version: number;
  reason: string;
  createdAt: Date;
  size: number;
}

export interface RestoreSnapshotResult {
  success: boolean;
  id: string;
  version: number;
  restoredFromVersion: number;
  createdAt: Date;
}

@Injectable()
export class BoardSnapshotsService {
  constructor(
    private readonly boardAclService: BoardAclService,
    private readonly snapshotsRepository: SnapshotsRepository,
    private readonly redis: RedisService,
  ) {}

  private toSnapshotListItem(record: SnapshotRecord): SnapshotListItem {
    return {
      id: record.id,
      boardId: record.boardId,
      version: record.version,
      reason: record.reason,
      createdAt: record.createdAt,
      size: record.data.length,
    };
  }

  async listSnapshots(boardId: string, userId: string): Promise<SnapshotListItem[]> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId);

    const snapshots = await this.snapshotsRepository.findManyByBoard(boardId, 50);

    return snapshots.map((s) => this.toSnapshotListItem(s));
  }

  async createManualSnapshot(boardId: string, userId: string): Promise<SnapshotListItem> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertCanEdit(board, 'Only owners and editors can create snapshots');

    let stateBytes = await this.snapshotsRepository.loadMergedBoardState(boardId);
    if (!stateBytes) {
      const emptyDoc = new Y.Doc();
      stateBytes = Y.encodeStateAsUpdate(emptyDoc);
      emptyDoc.destroy();
    }

    const latestByVersion = await this.snapshotsRepository.findLatestByVersion(boardId);
    const nextVersion = (latestByVersion?.version ?? 0) + 1;

    const created = await this.snapshotsRepository.create({
      boardId,
      data: stateBytes,
      version: nextVersion,
      reason: SnapshotReason.MANUAL,
    });

    return this.toSnapshotListItem(created);
  }

  async restoreSnapshot(
    boardId: string,
    snapshotId: string,
    userId: string,
  ): Promise<RestoreSnapshotResult> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    this.boardAclService.assertCanEdit(board, 'Only owners and editors can restore snapshots');

    const targetSnapshot = await this.snapshotsRepository.findByIdAndBoard(snapshotId, boardId);

    if (!targetSnapshot) {
      throw new NotFoundException('Snapshot not found');
    }

    const latestSnapshot = await this.snapshotsRepository.findLatestByVersion(boardId);
    const currentMergedState = await this.snapshotsRepository.loadMergedBoardState(boardId);
    let nextVersion = (latestSnapshot?.version ?? targetSnapshot.version) + 1;

    if (currentMergedState && latestSnapshot?.id !== targetSnapshot.id) {
      await this.snapshotsRepository.create({
        boardId,
        data: currentMergedState,
        version: nextVersion,
        reason: SnapshotReason.PRE_RESTORE,
      });
      nextVersion += 1;
    }

    const restoredRecord = await this.snapshotsRepository.create({
      boardId,
      data: targetSnapshot.data,
      version: nextVersion,
      reason: `RESTORED_FROM_V${targetSnapshot.version}`,
    });

    await this.snapshotsRepository.deleteUpdatesByBoard(boardId);

    await this.redis.client.publish(
      redisChannels.restore(boardId),
      JSON.stringify({
        snapshotId: targetSnapshot.id,
        version: nextVersion,
        data: Buffer.from(targetSnapshot.data).toString('base64'),
      }),
    );

    return {
      success: true,
      id: restoredRecord.id,
      version: restoredRecord.version,
      restoredFromVersion: targetSnapshot.version,
      createdAt: restoredRecord.createdAt,
    };
  }
}
