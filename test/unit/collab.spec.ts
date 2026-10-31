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

  it('restores an older snapshot over modified and deleted elements without republishing to Redis updates', () => {
    const { mock, ws } = createMockWs();
    room.attach(ws, { userId: 'u1', userName: 'Alice', role: 'EDITOR' });

    room.doc.transact(() => {
      const roots = getDocRoots(room.doc);
      const el1 = new Y.Map<unknown>();
      el1.set('id', 'el-1');
      el1.set('type', 'rect');
      el1.set('x', 10);
      el1.set('y', 20);
      el1.set('w', 100);
      el1.set('h', 80);
      el1.set('z', 1);
      el1.set('createdBy', 'u1');
      const style = new Y.Map<unknown>();
      style.set('fill', '#ffffff');
      style.set('stroke', '#000000');
      style.set('strokeWidth', 2);
      style.set('opacity', 1);
      el1.set('style', style);
      roots.elements.set('el-1', el1);
    }, 'init');

    const snapshotBytes = Y.encodeStateAsUpdate(room.doc);

    room.doc.transact(() => {
      const roots = getDocRoots(room.doc);
      roots.elements.delete('el-1');
      const el2 = new Y.Map<unknown>();
      el2.set('id', 'el-2');
      el2.set('type', 'ellipse');
      roots.elements.set('el-2', el2);
    }, 'redis');

    expect(getDocRoots(room.doc).elements.has('el-1')).toBe(false);
    expect(getDocRoots(room.doc).elements.has('el-2')).toBe(true);

    mockRedis.client.publish.mockClear();
    mockPersistence.queueUpdate.mockClear();
    mock.send.mockClear();

    room.restoreSnapshot(snapshotBytes);

    const restoredElements = getDocRoots(room.doc).elements;
    expect(restoredElements.size).toBe(1);
    expect(restoredElements.has('el-1')).toBe(true);
    expect(restoredElements.has('el-2')).toBe(false);
    const restoredEl1 = restoredElements.get('el-1') as Y.Map<unknown>;
    expect(restoredEl1.get('x')).toBe(10);
    expect((restoredEl1.get('style') as Y.Map<unknown>).get('fill')).toBe('#ffffff');

    expect(mock.send).toHaveBeenCalled();
    expect(mockRedis.client.publish).not.toHaveBeenCalled();
    expect(mockPersistence.queueUpdate).not.toHaveBeenCalled();
  });

  it('rejects mutations or deletions of locked elements and blocks unknown element fields', () => {
    const { ws } = createMockWs();
    room.attach(ws, { userId: 'e1', userName: 'Editor', role: 'EDITOR' });

    room.doc.transact(() => {
      const roots = getDocRoots(room.doc);
      const lockedEl = new Y.Map<unknown>();
      lockedEl.set('id', 'locked-1');
      lockedEl.set('type', 'rect');
      lockedEl.set('x', 0);
      lockedEl.set('y', 0);
      lockedEl.set('w', 100);
      lockedEl.set('h', 100);
      lockedEl.set('rotation', 0);
      lockedEl.set('z', 'a0');
      lockedEl.set('createdBy', 'u1');
      lockedEl.set('locked', true);
      const style = new Y.Map<unknown>();
      style.set('fill', '#fff');
      style.set('stroke', '#000');
      style.set('strokeWidth', 2);
      style.set('opacity', 1);
      lockedEl.set('style', style);
      roots.elements.set('locked-1', lockedEl);
    }, 'init');

    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(room.doc));
    const sv = Y.encodeStateVector(clientDoc);

    clientDoc.transact(() => {
      const el = getDocRoots(clientDoc).elements.get('locked-1')!;
      el.set('x', 500);
    });
    const moveLockedUpdate = Y.encodeStateAsUpdate(clientDoc, sv);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG.SYNC);
    syncProtocol.writeUpdate(enc, moveLockedUpdate);
    room.handleMessage(ws, encoding.toUint8Array(enc));

    const authoritativeLocked = getDocRoots(room.doc).elements.get('locked-1')!;
    expect(authoritativeLocked.get('x')).toBe(0);
  });

  it('enforces authenticated userId and role on awareness updates to prevent identity spoofing', () => {
    const { ws } = createMockWs();
    room.attach(ws, { userId: 'viewer-real-id', userName: 'Viewer', role: 'VIEWER' });

    const clientDoc = new Y.Doc();
    const clientAw = new awarenessProtocol.Awareness(clientDoc);
    clientAw.setLocalStateField('user', {
      id: 'spoofed-owner-id',
      name: 'Fake Owner',
      color: '#ef4444',
      role: 'OWNER',
    });
    const update = awarenessProtocol.encodeAwarenessUpdate(clientAw, [clientDoc.clientID]);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
    room.handleMessage(ws, encoding.toUint8Array(encoder));

    const storedState = room.awareness.getStates().get(clientDoc.clientID) as {
      user?: { id: string; role: string };
    };
    expect(storedState?.user?.id).toBe('viewer-real-id');
    expect(storedState?.user?.role).toBe('VIEWER');
  });
});
