import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as Y from 'yjs';
import Redis from 'ioredis';
import { Room } from './room';
import { PersistenceService } from '../persistence/persistence.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RoomManagerService implements OnModuleInit, OnModuleDestroy {
  private rooms = new Map<string, Room>();
  private unloadTimers = new Map<string, NodeJS.Timeout>();
  private subscriberClient: Redis | null = null;

  constructor(
    private readonly persistence: PersistenceService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    // Dedicated redis subscriber for room pub/sub
    this.subscriberClient = this.redis.duplicate();
    this.subscriberClient.on('message', (channel, message) => {
      // Channel: board:{boardId}:updates
      const match = channel.match(/^board:(.+):updates$/);
      if (match) {
        const boardId = match[1];
        const room = this.rooms.get(boardId);
        if (room) {
          room.applyRemoteRedisUpdate(message);
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
    // Cancel unload timer if scheduled
    const existingTimer = this.unloadTimers.get(boardId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.unloadTimers.delete(boardId);
    }

    let room = this.rooms.get(boardId);
    if (room) return room;

    room = new Room(boardId, this.persistence, this.redis);

    // Hydrate from DB: snapshot + subsequent updates
    const initial = await this.persistence.loadInitialState(boardId);
    if (initial.snapshot) {
      Y.applyUpdate(room.doc, initial.snapshot);
    }
    for (const update of initial.updates) {
      Y.applyUpdate(room.doc, update);
    }

    this.rooms.set(boardId, room);

    // Subscribe to redis updates for this room
    if (this.subscriberClient) {
      await this.subscriberClient.subscribe(`board:${boardId}:updates`);
    }

    return room;
  }

  scheduleUnload(boardId: string) {
    const room = this.rooms.get(boardId);
    if (!room || room.clients.size > 0) return;

    if (this.unloadTimers.has(boardId)) return;

    // After 60s idle with no connected clients: flush snapshot and unload from memory
    const timer = setTimeout(async () => {
      this.unloadTimers.delete(boardId);
      const activeRoom = this.rooms.get(boardId);
      if (activeRoom && activeRoom.clients.size === 0) {
        await activeRoom.createSnapshot();
        activeRoom.destroy();
        this.rooms.delete(boardId);
        if (this.subscriberClient) {
          await this.subscriberClient.unsubscribe(`board:${boardId}:updates`);
        }
      }
    }, 60_000);

    this.unloadTimers.set(boardId, timer);
  }
}
