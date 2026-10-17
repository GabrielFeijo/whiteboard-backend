import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import * as Y from 'yjs';
import { z } from 'zod';
import { MetricsService } from '../../core/observability/metrics/metrics.service';
import { redisChannels } from '../../core/redis/redis-keys';
import { RedisService } from '../../core/redis/redis.service';
import { PersistenceService } from '../persistence/persistence.service';
import { Room } from './room';
import { YjsValidatorService } from './services/yjs-validator.service';

const RedisRestorePayloadSchema = z.object({
  snapshotId: z.string(),
  version: z.number(),
  data: z.string().min(1),
});

const RedisAclPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REVOKE_LINK'),
    linkId: z.string().min(1),
  }),
  z.object({
    type: z.literal('REMOVE_MEMBER'),
    userId: z.string().min(1),
  }),
]);

@Injectable()
export class RoomManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomManagerService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly roomLoadingPromises = new Map<string, Promise<Room>>();
  private readonly unloadTimers = new Map<string, NodeJS.Timeout>();
  private subscriberClient: Redis | null = null;
  private readonly validator: YjsValidatorService;

  constructor(
    private readonly persistence: PersistenceService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    @Optional() validator?: YjsValidatorService,
  ) {
    this.validator = validator ?? new YjsValidatorService();
  }

  onModuleInit(): void {
    this.subscriberClient = this.redis.duplicate();
    this.subscriberClient.on('error', (err: Error) => {
      this.logger.error(`Redis subscriber client error: ${err.message}`, err.stack);
    });
    this.subscriberClient.on('message', (channel: string, message: string) => {
      this.handleRedisMessage(channel, message);
    });
  }

  private handleRedisMessage(channel: string, message: string): void {
    const match = channel.match(/^board:(.+):(updates|restore|acl)$/);
    if (!match) return;

    const [, boardId, action] = match;
    const room = this.rooms.get(boardId);
    if (!room) return;

    if (action === 'updates') {
      room.applyRemoteRedisUpdate(message);
      return;
    }

    if (action === 'restore') {
      this.applyRedisRestore(boardId, room, message);
      return;
    }

    if (action === 'acl') {
      this.applyRedisAcl(boardId, room, message);
      return;
    }
  }

  private applyRedisRestore(boardId: string, room: Room, message: string): void {
    try {
      const parsedJson: unknown = JSON.parse(message);
      const validated = RedisRestorePayloadSchema.safeParse(parsedJson);
      if (!validated.success) {
        this.logger.warn(`Invalid restore payload on board ${boardId}`);
        return;
      }
      const snapshotBuffer = Buffer.from(validated.data.data, 'base64');
      room.restoreSnapshot(new Uint8Array(snapshotBuffer));
    } catch (err) {
      this.logger.error(`Failed to apply restored snapshot to room ${boardId}`, err);
    }
  }

  private applyRedisAcl(boardId: string, room: Room, message: string): void {
    try {
      const parsedJson: unknown = JSON.parse(message);
      const validated = RedisAclPayloadSchema.safeParse(parsedJson);
      if (!validated.success) {
        this.logger.warn(`Invalid ACL payload on board ${boardId}`);
        return;
      }

      if (validated.data.type === 'REVOKE_LINK') {
        room.revokeClientAccess({ linkId: validated.data.linkId });
        return;
      }

      if (validated.data.type === 'REMOVE_MEMBER') {
        room.revokeClientAccess({ userId: validated.data.userId });
        return;
      }
    } catch (err) {
      this.logger.error(`Failed to process ACL event for room ${boardId}`, err);
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const [, timer] of this.unloadTimers) {
      clearTimeout(timer);
    }
    this.unloadTimers.clear();

    for (const [, room] of this.rooms) {
      await room.createSnapshot();
      room.destroy();
    }
    this.rooms.clear();

    if (this.subscriberClient) {
      await this.subscriberClient.quit();
      this.subscriberClient = null;
    }
  }

  getActiveRoom(boardId: string): Room | undefined {
    return this.rooms.get(boardId);
  }

  async getOrLoadRoom(boardId: string): Promise<Room> {
    const existingTimer = this.unloadTimers.get(boardId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.unloadTimers.delete(boardId);
    }

    const existingRoom = this.rooms.get(boardId);
    if (existingRoom) return existingRoom;

    const inFlight = this.roomLoadingPromises.get(boardId);
    if (inFlight) return inFlight;

    const loadPromise = this.internalLoadRoom(boardId).finally(() => {
      this.roomLoadingPromises.delete(boardId);
    });

    this.roomLoadingPromises.set(boardId, loadPromise);
    return loadPromise;
  }

  private async internalLoadRoom(boardId: string): Promise<Room> {
    const room = new Room(boardId, this.persistence, this.redis, this.validator);

    const initial = await this.persistence.loadInitialState(boardId);
    if (initial.snapshot) {
      Y.applyUpdate(room.doc, initial.snapshot);
    }
    for (const update of initial.updates) {
      Y.applyUpdate(room.doc, update);
    }

    this.rooms.set(boardId, room);
    this.metrics.setActiveRooms(this.rooms.size);

    if (this.subscriberClient) {
      await this.subscriberClient.subscribe(
        redisChannels.updates(boardId),
        redisChannels.restore(boardId),
        redisChannels.acl(boardId),
      );
    }

    return room;
  }

  scheduleUnload(boardId: string): void {
    const room = this.rooms.get(boardId);
    if (!room || room.clients.size > 0) return;

    if (this.unloadTimers.has(boardId)) return;

    const timer = setTimeout(() => {
      void this.unloadRoomIfEmpty(boardId);
    }, 60_000);

    this.unloadTimers.set(boardId, timer);
  }

  private async unloadRoomIfEmpty(boardId: string): Promise<void> {
    this.unloadTimers.delete(boardId);
    const activeRoom = this.rooms.get(boardId);
    if (activeRoom && activeRoom.clients.size === 0) {
      try {
        await activeRoom.createSnapshot();
      } catch (err) {
        this.logger.error(`Snapshot before unload failed for room ${boardId}`, err);
      }
      activeRoom.destroy();
      this.rooms.delete(boardId);
      this.metrics.setActiveRooms(this.rooms.size);
      if (this.subscriberClient) {
        await this.subscriberClient.unsubscribe(
          redisChannels.updates(boardId),
          redisChannels.restore(boardId),
          redisChannels.acl(boardId),
        );
      }
    }
  }
}
