import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MetricsService } from '../../src/core/observability/metrics/metrics.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { PersistenceService } from '../../src/modules/persistence/persistence.service';
import { RoomManagerService } from '../../src/modules/collab/room-manager.service';
import { YjsValidatorService } from '../../src/modules/collab/services/yjs-validator.service';

describe('Collab Room Initialization Persistence Safety', () => {
  let roomManager: RoomManagerService;
  let mockPersistence: {
    loadInitialState: ReturnType<typeof vi.fn>;
    queueUpdate: ReturnType<typeof vi.fn>;
    saveSnapshot: ReturnType<typeof vi.fn>;
  };
  let mockRedis: {
    client: {
      publish: ReturnType<typeof vi.fn>;
    };
    duplicate: ReturnType<typeof vi.fn>;
  };
  let mockMetrics: {
    setActiveRooms: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPersistence = {
      loadInitialState: vi.fn(),
      queueUpdate: vi.fn(),
      saveSnapshot: vi.fn(),
    };
    mockRedis = {
      client: {
        publish: vi.fn().mockResolvedValue(1),
      },
      duplicate: vi.fn().mockReturnValue({
        on: vi.fn(),
        subscribe: vi.fn().mockResolvedValue(1),
        unsubscribe: vi.fn().mockResolvedValue(1),
        quit: vi.fn().mockResolvedValue('OK'),
      }),
    };
    mockMetrics = {
      setActiveRooms: vi.fn(),
    };

    roomManager = new RoomManagerService(
      mockPersistence as unknown as PersistenceService,
      mockRedis as unknown as RedisService,
      mockMetrics as unknown as MetricsService,
      new YjsValidatorService(),
    );
  });

  it('does not re-queue loaded snapshots or updates to persistence or Redis when room loads', async () => {
    const seedDoc = new Y.Doc();
    const map = seedDoc.getMap('elements');
    const el = new Y.Map();
    el.set('id', 'el-1');
    map.set('el-1', el);
    const snapshotBytes = Y.encodeStateAsUpdate(seedDoc);

    const updateDoc = new Y.Doc();
    Y.applyUpdate(updateDoc, snapshotBytes);
    let capturedUpdate: Uint8Array | null = null;
    updateDoc.on('update', (u: Uint8Array) => {
      capturedUpdate = u;
    });
    updateDoc.getMap('elements').set('el-2', new Y.Map([['id', 'el-2']]));

    mockPersistence.loadInitialState.mockResolvedValue({
      snapshot: snapshotBytes,
      updates: capturedUpdate ? [capturedUpdate] : [],
    });

    const room = await roomManager.getOrLoadRoom('board-test-1');

    expect(room).toBeDefined();
    expect(mockPersistence.queueUpdate).not.toHaveBeenCalled();
    expect(mockRedis.client.publish).not.toHaveBeenCalled();
    expect(room.doc.getMap('elements').has('el-1')).toBe(true);

    room.destroy();
  });
});
