import * as encoding from 'lib0/encoding';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { RedisService } from '../../src/core/redis/redis.service';
import { Room } from '../../src/modules/collab/room';
import { PersistenceService } from '../../src/modules/persistence/persistence.service';
import { getDocRoots, MSG, WS_CLOSE } from '../../src/shared';

interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockWs(): { mock: MockWsClient; ws: WebSocket } {
  const mock: MockWsClient = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
  };
  return { mock, ws: mock as unknown as WebSocket };
}

describe('Room & Yjs Synchronization + CRDT Validation', () => {
  let room: Room;
  let mockPersistence: {
    queueUpdate: ReturnType<typeof vi.fn>;
    saveSnapshot: ReturnType<typeof vi.fn>;
  };
  let mockRedis: {
    client: {
      publish: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPersistence = {
      queueUpdate: vi.fn(),
      saveSnapshot: vi.fn(),
    };
    mockRedis = {
      client: {
        publish: vi.fn().mockResolvedValue(1),
      },
    };
    room = new Room(
      'board-123',
      mockPersistence as unknown as PersistenceService,
      mockRedis as unknown as RedisService,
    );
  });

  it('attaches a client and immediately sends server SyncStep1', () => {
    const { mock, ws } = createMockWs();

    room.attach(ws, { userId: 'u1', userName: 'Alice', role: 'EDITOR' });
    expect(mock.send).toHaveBeenCalled();

    const firstCallArg = mock.send.mock.calls[0]?.[0] as Uint8Array;
    const sent = new Uint8Array(firstCallArg);
    expect(sent[0]).toBe(MSG.SYNC);
  });

  it('ignores updates sent by clients with VIEWER role', () => {
    const { ws } = createMockWs();
    room.attach(ws, { userId: 'v1', userName: 'Bob Viewer', role: 'VIEWER' });

    const clientDoc = new Y.Doc();
    clientDoc.getText('text').insert(0, 'Illegal Edit');
    const update = Y.encodeStateAsUpdate(clientDoc);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    room.handleMessage(ws, msg);

    expect(room.doc.getText('text').toString()).toBe('');
  });

  it('applies valid updates from EDITOR clients and triggers persistence queue', () => {
    const { ws } = createMockWs();
    room.attach(ws, { userId: 'e1', userName: 'Editor', role: 'EDITOR' });

    const clientDoc = new Y.Doc();
    clientDoc.getText('text').insert(0, 'Hello World');
    const update = Y.encodeStateAsUpdate(clientDoc);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    room.handleMessage(ws, msg);

    expect(room.doc.getText('text').toString()).toBe('Hello World');
    expect(mockPersistence.queueUpdate).toHaveBeenCalledWith('board-123', expect.any(Uint8Array));
  });

  it('rejects CRDT updates with malformed element schema or non-owner meta changes', () => {
    const { mock, ws } = createMockWs();
    room.attach(ws, { userId: 'e1', userName: 'Editor', role: 'EDITOR' });

    const metaDoc = new Y.Doc();
    getDocRoots(metaDoc).meta.set('locked', true);
    const metaUpdate = Y.encodeStateAsUpdate(metaDoc);

    const metaEncoder = encoding.createEncoder();
    encoding.writeVarUint(metaEncoder, MSG.SYNC);
    syncProtocol.writeUpdate(metaEncoder, metaUpdate);
    room.handleMessage(ws, encoding.toUint8Array(metaEncoder));

    expect(getDocRoots(room.doc).meta.get('locked')).toBeUndefined();

    const badDoc = new Y.Doc();
    const badMap = new Y.Map<unknown>();
    badMap.set('id', 'bad-el');
    badMap.set('type', 'invalid-shape-type');
    getDocRoots(badDoc).elements.set('bad-el', badMap);
    const badUpdate = Y.encodeStateAsUpdate(badDoc);

    const badEncoder = encoding.createEncoder();
    encoding.writeVarUint(badEncoder, MSG.SYNC);
    syncProtocol.writeUpdate(badEncoder, badUpdate);
    room.handleMessage(ws, encoding.toUint8Array(badEncoder));

    expect(getDocRoots(room.doc).elements.size).toBe(0);
    expect(mock.send.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('disconnects client immediately when revokeClientAccess is triggered via ACL event', () => {
    const { mock, ws } = createMockWs();
    room.attach(ws, { userId: 'guest_1', userName: 'Guest', role: 'VIEWER', linkId: 'link-99' });

    room.revokeClientAccess({ linkId: 'link-99' });
    expect(mock.close).toHaveBeenCalledWith(WS_CLOSE.FORBIDDEN, 'Access revoked');
    expect(room.clients.has(ws)).toBe(false);
  });

  it('prunes client awareness states when client detaches', () => {
    const { ws } = createMockWs();
    room.attach(ws, { userId: 'u1', userName: 'Alice', role: 'EDITOR' });

    const clientDoc = new Y.Doc();
    const clientAw = new awarenessProtocol.Awareness(clientDoc);
    clientAw.setLocalStateField('user', { name: 'Alice', color: '#10b981' });
    const update = awarenessProtocol.encodeAwarenessUpdate(clientAw, [clientDoc.clientID]);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    room.handleMessage(ws, msg);
    expect(room.awareness.getStates().has(clientDoc.clientID)).toBe(true);

    room.detach(ws);
    expect(room.awareness.getStates().has(clientDoc.clientID)).toBe(false);
  });
});
