import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { MSG, Role, WS_CLOSE, getDocRoots, LIMITS } from '../shared';
import { PersistenceService } from '../persistence/persistence.service';
import { RedisService } from '../redis/redis.service';

export interface ClientMeta {
  userId: string;
  userName: string;
  role: Role;
}

export class Room {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly clients = new Map<WebSocket, ClientMeta>();
  readonly clientIdsBySocket = new Map<WebSocket, Set<number>>();
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;
  private readonly awarenessHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private dirtySinceLastSnapshot = false;

  constructor(
    readonly boardId: string,
    private readonly persistence: PersistenceService,
    private readonly redis: RedisService,
  ) {
    this.doc = new Y.Doc();
    this.doc.gc = true;
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      this.dirtySinceLastSnapshot = true;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG.SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const [ws] of this.clients) {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      }

      if (origin !== 'redis') {
        this.redis.client
          .publish(`board:${this.boardId}:updates`, Buffer.from(update).toString('base64'))
          .catch(console.error);

        this.persistence.queueUpdate(this.boardId, update);
      }
    };
    this.doc.on('update', this.updateHandler);

    this.awarenessHandler = ({ added, updated, removed }, origin: unknown) => {
      if (origin && this.clients.has(origin as WebSocket)) {
        const ws = origin as WebSocket;
        let set = this.clientIdsBySocket.get(ws);
        if (!set) {
          set = new Set();
          this.clientIdsBySocket.set(ws, set);
        }
        for (const id of added) set.add(id);
        for (const id of updated) set.add(id);
        for (const id of removed) set.delete(id);
      }

      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG.AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);

      for (const [ws] of this.clients) {
        if (ws !== origin && ws.readyState === WebSocket.OPEN) {
          ws.send(buff);
        }
      }
    };
    this.awareness.on('update', this.awarenessHandler);

    this.snapshotInterval = setInterval(
      () => {
        if (this.dirtySinceLastSnapshot) {
          this.createSnapshot().catch(console.error);
        }
      },
      5 * 60 * 1000,
    );
  }

  async createSnapshot() {
    this.dirtySinceLastSnapshot = false;
    const bytes = Y.encodeStateAsUpdate(this.doc);
    await this.persistence.saveSnapshot(this.boardId, bytes, 'AUTO');
  }

  attach(ws: WebSocket, meta: ClientMeta) {
    this.clients.set(ws, meta);
    this.clientIdsBySocket.set(ws, new Set());

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awEncoder = encoding.createEncoder();
      encoding.writeVarUint(awEncoder, MSG.AWARENESS);
      encoding.writeVarUint8Array(
        awEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
      );
      ws.send(encoding.toUint8Array(awEncoder));
    }
  }

  handleMessage(ws: WebSocket, data: Uint8Array) {
    const meta = this.clients.get(ws);
    if (!meta) return;

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    if (messageType === MSG.SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG.SYNC);

      const syncMessageType = decoding.readVarUint(decoder);
      decoder.pos--;

      if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      } else {
        if (meta.role === 'VIEWER') {
          return;
        }

        const roots = getDocRoots(this.doc);
        if (roots.elements.size > LIMITS.MAX_ELEMENTS) {
          ws.close(WS_CLOSE.FORBIDDEN, 'Element limit exceeded');
          return;
        }

        syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      }
    } else if (messageType === MSG.AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        ws,
      );
    }
  }

  detach(ws: WebSocket) {
    this.clients.delete(ws);
    const clientIds = this.clientIdsBySocket.get(ws);
    if (clientIds && clientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        Array.from(clientIds),
        null,
      );
    }
    this.clientIdsBySocket.delete(ws);
    if (this.clients.size === 0) {
      const remainingIds = Array.from(this.awareness.getStates().keys());
      if (remainingIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(this.awareness, remainingIds, null);
      }
    }
  }

  applyRemoteRedisUpdate(updateBase64: string) {
    const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
    Y.applyUpdate(this.doc, update, 'redis');
  }

  restoreSnapshot(snapshotData: Uint8Array) {
    this.doc.transact(() => {
      const roots = getDocRoots(this.doc);
      roots.elements.forEach((_val: unknown, key: string) => {
        roots.elements.delete(key);
      });
    }, 'restore');

    Y.applyUpdate(this.doc, snapshotData, 'restore');

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc));
    const message = encoding.toUint8Array(encoder);

    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }

  destroy() {
    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    this.doc.off('update', this.updateHandler);
    this.awareness.off('update', this.awarenessHandler);
    this.doc.destroy();
  }
}
