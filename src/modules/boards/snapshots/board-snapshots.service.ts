import { Injectable, NotFoundException } from '@nestjs/common';
import { redisChannels } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';
import { BoardAclService } from '../services/board-acl.service';
import { SnapshotsRepository } from './snapshots.repository';

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

  async listSnapshots(boardId: string, userId: string): Promise<SnapshotListItem[]> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId);

    const snapshots = await this.snapshotsRepository.findManyByBoard(boardId, 50);

    return snapshots.map((s) => ({
      id: s.id,
      boardId: s.boardId,
      version: s.version,
      reason: s.reason,
      createdAt: s.createdAt,
      size: s.data.length,
    }));
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
    const newVersion = (latestSnapshot?.version ?? targetSnapshot.version) + 1;

    const restoredRecord = await this.snapshotsRepository.create({
      boardId,
      data: targetSnapshot.data,
      version: newVersion,
      reason: `RESTORED_FROM_V${targetSnapshot.version}`,
    });

    await this.redis.client.publish(
      redisChannels.restore(boardId),
      JSON.stringify({
        snapshotId: targetSnapshot.id,
        version: newVersion,
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
