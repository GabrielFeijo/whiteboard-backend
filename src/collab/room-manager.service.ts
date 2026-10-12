import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Y from 'yjs';
import Redis from 'ioredis';
import { Room } from './room';
import { PersistenceService } from '../persistence/persistence.service';
import { RedisService } from '../redis/redis.service';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RoomManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoomManagerService.name);
  private rooms = new Map<string, Room>();
  private roomLoadingPromises = new Map<string, Promise<Room>>();
  private unloadTimers = new Map<string, NodeJS.Timeout>();
  private subscriberClient: Redis | null = null;

  constructor(
    private readonly persistence: PersistenceService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit() {
    this.subscriberClient = this.redis.duplicate();
    this.subscriberClient.on('message', (channel, message) => {
      const matchUpdate = channel.match(/^board:(.+):updates$/);
      if (matchUpdate) {
        const boardId = matchUpdate[1];
        const room = this.rooms.get(boardId);
        if (room) {
          room.applyRemoteRedisUpdate(message);
        }
        return;
      }

      const matchRestore = channel.match(/^board:(.+):restore$/);
      if (matchRestore) {
        const boardId = matchRestore[1];
        const room = this.rooms.get(boardId);
        if (room) {
          try {
            const payload = JSON.parse(message);
            const snapshotBuffer = Buffer.from(payload.data, 'base64');
            room.restoreSnapshot(new Uint8Array(snapshotBuffer));
          } catch (err) {
            this.logger.error(`Failed to apply restored snapshot to room ${boardId}`, err);
          }
        }
      }
    });
  }

  async onModuleDestroy() {
    for (const [, timer] of this.unloadTimers) {
      clearTimeout(timer);
    }
    for (const [, room] of this.rooms) {
      await room.createSnapshot();
      room.destroy();
    }
    if (this.subscriberClient) {
      await this.subscriberClient.quit();
    }
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
    const room = new Room(boardId, this.persistence, this.redis);

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
      await this.subscriberClient.subscribe(`board:${boardId}:updates`, `board:${boardId}:restore`);
    }

    return room;
  }

  scheduleUnload(boardId: string) {
    const room = this.rooms.get(boardId);
    if (!room || room.clients.size > 0) return;

    if (this.unloadTimers.has(boardId)) return;

    const timer = setTimeout(async () => {
      this.unloadTimers.delete(boardId);
      const activeRoom = this.rooms.get(boardId);
      if (activeRoom && activeRoom.clients.size === 0) {
        await activeRoom.createSnapshot();
        activeRoom.destroy();
        this.rooms.delete(boardId);
        this.metrics.setActiveRooms(this.rooms.size);
        if (this.subscriberClient) {
          await this.subscriberClient.unsubscribe(
            `board:${boardId}:updates`,
            `board:${boardId}:restore`,
          );
        }
      }
    }, 60_000);

    this.unloadTimers.set(boardId, timer);
  }
}
