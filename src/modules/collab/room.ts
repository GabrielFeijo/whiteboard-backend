import { Logger } from '@nestjs/common';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { redisChannels } from '../../core/redis/redis-keys';
import { RedisService } from '../../core/redis/redis.service';
import { getDocRoots, LIMITS, MSG, Role, SnapshotReason, WS_CLOSE } from '../../shared';
import { PersistenceService } from '../persistence/persistence.service';
import { SyncValidationFailureReason, YjsValidatorService } from './services/yjs-validator.service';

export interface ClientMeta {
  userId: string;
  userName: string;
  role: Role;
  linkId?: string;
}

export class Room {
  private readonly logger = new Logger(Room.name);
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
  private readonly validator: YjsValidatorService;
  private shadowDoc: Y.Doc;

  constructor(
    readonly boardId: string,
    private readonly persistence: PersistenceService,
    private readonly redis: RedisService,
    validator?: YjsValidatorService,
  ) {
    this.validator = validator ?? new YjsValidatorService();
    this.doc = new Y.Doc();
    this.doc.gc = true;
    this.shadowDoc = new Y.Doc();
    this.shadowDoc.gc = true;
    const initialDocState = Y.encodeStateAsUpdate(this.doc);
    if (initialDocState.length > 0) {
      Y.applyUpdate(this.shadowDoc, initialDocState);
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      this.dirtySinceLastSnapshot = true;
      if (!this.clients.has(origin as WebSocket)) {
        Y.applyUpdate(this.shadowDoc, update);
      }
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
          .publish(redisChannels.updates(this.boardId), Buffer.from(update).toString('base64'))
          .catch((err: unknown) => {
            this.logger.error(`Redis publish update failed for board ${this.boardId}`, err);
          });

        this.persistence.queueUpdate(this.boardId, update);
      }
    };
    this.doc.on('update', this.updateHandler);

    this.awarenessHandler = ({ added, updated, removed }, origin: unknown) => {
      this.trackClientAwarenessIds(origin, added, updated, removed);
      this.broadcastAwarenessUpdate(added, updated, removed, origin);
    };
    this.awareness.on('update', this.awarenessHandler);

    this.snapshotInterval = setInterval(
      () => {
        if (this.dirtySinceLastSnapshot) {
          this.createSnapshot().catch((err: unknown) => {
            this.logger.error(`Automatic snapshot failed for board ${this.boardId}`, err);
          });
        }
      },
      5 * 60 * 1000,
    );
  }

  async createSnapshot(): Promise<void> {
    this.dirtySinceLastSnapshot = false;
    const bytes = Y.encodeStateAsUpdate(this.doc);
    await this.persistence.saveSnapshot(this.boardId, bytes, SnapshotReason.AUTO);
  }

  attach(ws: WebSocket, meta: ClientMeta): void {
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

  private sendAuthoritativeStateToClient(ws: WebSocket): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(this.doc));
    ws.send(encoding.toUint8Array(encoder));
  }

  handleMessage(ws: WebSocket, data: Uint8Array): void {
    const meta = this.clients.get(ws);
    if (!meta) return;

    try {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MSG.SYNC) {
        this.processSyncMessage(ws, decoder, meta, data);
        return;
      }

      if (messageType === MSG.AWARENESS) {
        this.processAwarenessMessage(ws, decoder);
        return;
      }
    } catch (err) {
      this.logger.warn(`Failed to process message from client in room ${this.boardId}`, err);
    }
  }

  private processAwarenessMessage(ws: WebSocket, decoder: decoding.Decoder): void {
    awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), ws);
  }

  private processSyncMessage(
    ws: WebSocket,
    decoder: decoding.Decoder,
    meta: ClientMeta,
    data: Uint8Array,
  ): void {
    const syncPayloadOffset = decoder.pos;
    const syncMessageType = decoding.readVarUint(decoder);
    decoder.pos = syncPayloadOffset;

    if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
      this.handleSyncStep1(ws, decoder);
      return;
    }

    this.handleSyncUpdate(ws, decoder, meta, data, syncPayloadOffset);
  }

  private handleSyncStep1(ws: WebSocket, decoder: decoding.Decoder): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
    this.sendEncodedReply(ws, encoder);
  }

  private handleSyncUpdate(
    ws: WebSocket,
    decoder: decoding.Decoder,
    meta: ClientMeta,
    data: Uint8Array,
    syncPayloadOffset: number,
  ): void {
    if (meta.role === Role.VIEWER) {
      return;
    }

    if (this.isElementLimitExceeded()) {
      ws.close(WS_CLOSE.FORBIDDEN, 'Element limit exceeded');
      return;
    }

    const syncPayloadSlice = data.subarray(syncPayloadOffset);
    const validation = this.validator.validateSyncUpdate(
      this.doc,
      syncPayloadSlice,
      meta.role,
      this.shadowDoc,
    );

    if (!validation.valid) {
      this.recreateShadowDoc();
      this.handleValidationFailure(ws, meta, validation.reason);
      return;
    }

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG.SYNC);
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
    this.sendEncodedReply(ws, encoder);
  }

  private recreateShadowDoc(): void {
    this.shadowDoc.destroy();
    this.shadowDoc = new Y.Doc();
    this.shadowDoc.gc = true;
    const current = Y.encodeStateAsUpdate(this.doc);
    if (current.length > 0) {
      Y.applyUpdate(this.shadowDoc, current);
    }
  }

  private isElementLimitExceeded(): boolean {
    const roots = getDocRoots(this.doc);
    return roots.elements.size > LIMITS.MAX_ELEMENTS;
  }

  private handleValidationFailure(
    ws: WebSocket,
    meta: ClientMeta,
    reason?: SyncValidationFailureReason,
  ): void {
    if (reason === SyncValidationFailureReason.ELEMENT_QUOTA_EXCEEDED) {
      ws.close(WS_CLOSE.FORBIDDEN, 'Element limit exceeded');
      return;
    }

    this.logger.warn(
      `Rejected invalid Yjs update (${reason}) from user ${meta.userId} in board ${this.boardId}`,
    );
    this.sendAuthoritativeStateToClient(ws);
  }

  private trackClientAwarenessIds(
    origin: unknown,
    added: number[],
    updated: number[],
    removed: number[],
  ): void {
    if (!origin || !this.clients.has(origin as WebSocket)) {
      return;
    }

    const ws = origin as WebSocket;
    const set = this.clientIdsBySocket.get(ws) ?? new Set<number>();
    this.clientIdsBySocket.set(ws, set);

    for (const id of added) set.add(id);
    for (const id of updated) set.add(id);
    for (const id of removed) set.delete(id);
  }

  private broadcastAwarenessUpdate(
    added: number[],
    updated: number[],
    removed: number[],
    origin: unknown,
  ): void {
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
  }

  private sendEncodedReply(ws: WebSocket, encoder: encoding.Encoder): void {
    if (encoding.length(encoder) <= 1) {
      return;
    }
    ws.send(encoding.toUint8Array(encoder));
  }

  revokeClientAccess(filter: { userId?: string; linkId?: string }): void {
    for (const [ws, meta] of this.clients.entries()) {
      const matchesUser = Boolean(filter.userId && meta.userId === filter.userId);
      const matchesLink = Boolean(filter.linkId && meta.linkId === filter.linkId);
      if (!matchesUser && !matchesLink) {
        continue;
      }
      if (typeof ws.close === 'function') {
        ws.close(WS_CLOSE.FORBIDDEN, 'Access revoked');
      }
      this.detach(ws);
    }
  }

  detach(ws: WebSocket): void {
    this.clients.delete(ws);
    const clientIds = this.clientIdsBySocket.get(ws);
    if (clientIds && clientIds.size > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(clientIds), null);
    }
    this.clientIdsBySocket.delete(ws);

    if (this.clients.size > 0) {
      return;
    }

    const remainingIds = Array.from(this.awareness.getStates().keys());
    if (remainingIds.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, remainingIds, null);
    }
  }

  applyRemoteRedisUpdate(updateBase64: string): void {
    const update = new Uint8Array(Buffer.from(updateBase64, 'base64'));
    Y.applyUpdate(this.doc, update, 'redis');
  }

  restoreSnapshot(snapshotData: Uint8Array): void {
    this.doc.transact(() => {
      const roots = getDocRoots(this.doc);
      roots.elements.forEach((_val: unknown, key: string) => {
        roots.elements.delete(key);
      });
    }, 'restore');

    Y.applyUpdate(this.doc, snapshotData, 'restore');
    this.recreateShadowDoc();

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

  destroy(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    this.doc.off('update', this.updateHandler);
    this.awareness.off('update', this.awarenessHandler);
    this.shadowDoc.destroy();
    this.doc.destroy();
  }
}
