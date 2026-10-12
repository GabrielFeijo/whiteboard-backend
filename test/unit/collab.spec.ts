/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { Room } from '../../src/collab/room';
import { MSG } from '../../src/shared';

describe('Room & Yjs Synchronization', () => {
  let room: Room;
  let mockPersistence: any;
  let mockRedis: any;

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
    room = new Room('board-123', mockPersistence, mockRedis);
  });

  it('attaches a client and immediately sends server SyncStep1', () => {
    const mockWs: any = {
      readyState: 1,
      send: vi.fn(),
    };

    room.attach(mockWs, { userId: 'u1', userName: 'Alice', role: 'EDITOR' });
    expect(mockWs.send).toHaveBeenCalled();

    const sent = new Uint8Array(mockWs.send.mock.calls[0][0]);
    expect(sent[0]).toBe(MSG.SYNC);
  });

  it('ignores updates sent by clients with VIEWER role', () => {
    const mockWs: any = { readyState: 1, send: vi.fn() };
    room.attach(mockWs, { userId: 'v1', userName: 'Bob Viewer', role: 'VIEWER' });

    // Create an update from a client doc
    const clientDoc = new Y.Doc();
    clientDoc.getText('text').insert(0, 'Illegal Edit');
    const update = Y.encodeStateAsUpdate(clientDoc);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    room.handleMessage(mockWs, msg);

    // Document in room should remain empty
    expect(room.doc.getText('text').toString()).toBe('');
  });

  it('applies valid updates from EDITOR clients and triggers persistence queue', () => {
    const mockWs: any = { readyState: 1, send: vi.fn() };
    room.attach(mockWs, { userId: 'e1', userName: 'Editor', role: 'EDITOR' });

    const clientDoc = new Y.Doc();
    clientDoc.getText('text').insert(0, 'Hello World');
    const update = Y.encodeStateAsUpdate(clientDoc);

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const msg = encoding.toUint8Array(encoder);

    room.handleMessage(mockWs, msg);

    expect(room.doc.getText('text').toString()).toBe('Hello World');
    expect(mockPersistence.queueUpdate).toHaveBeenCalledWith('board-123', expect.any(Uint8Array));
  });
});
