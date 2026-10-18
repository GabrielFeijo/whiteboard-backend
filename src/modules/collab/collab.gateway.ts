import { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import { Server, WebSocket } from 'ws';
import { Env } from '../../core/config/env';
import { MetricsService } from '../../core/observability/metrics/metrics.service';
import { LIMITS, WS_CLOSE } from '../../shared';
import { RoomManagerService } from './room-manager.service';
import { WsAuthService } from './ws-auth.service';

interface ClientSocketContext {
  userId: string;
  boardId: string;
  isAlive: boolean;
}

@WebSocketGateway()
export class CollabGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly socketContexts = new Map<WebSocket, ClientSocketContext>();
  private readonly userConnectionCounts = new Map<string, number>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly roomManager: RoomManagerService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {}

  afterInit(): void {
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const [ws, ctx] of this.socketContexts) {
        if (!ctx.isAlive) {
          ws.terminate();
          continue;
        }
        ctx.isAlive = false;
        ws.ping();
      }
    }, LIMITS.PING_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async handleConnection(client: WebSocket, req: IncomingMessage): Promise<void> {
    if (!this.isOriginAllowed(req.headers.origin)) {
      client.close(WS_CLOSE.FORBIDDEN, 'Origin not allowed');
      return;
    }

    const ticket = this.extractTicket(req.url);
    if (!ticket) {
      client.close(WS_CLOSE.UNAUTHORIZED, 'Ticket required');
      return;
    }

    const payload = await this.wsAuth.consumeTicket(ticket);
    if (!payload) {
      client.close(WS_CLOSE.UNAUTHORIZED, 'Invalid or expired ticket');
      return;
    }

    if (this.isUserRateLimited(payload.userId)) {
      client.close(WS_CLOSE.RATE_LIMITED, 'Too many connections for user');
      return;
    }

    this.registerConnection(client, payload.userId, payload.boardId);

    client.on('pong', () => {
      const ctx = this.socketContexts.get(client);
      if (ctx) ctx.isAlive = true;
    });

    try {
      const room = await this.roomManager.getOrLoadRoom(payload.boardId);

      if (!this.socketContexts.has(client) || client.readyState !== WebSocket.OPEN) {
        this.unregisterConnection(client, payload.userId);
        return;
      }

      if (room.clients.size >= LIMITS.MAX_PARTICIPANTS_PER_BOARD) {
        this.unregisterConnection(client, payload.userId);
        client.close(WS_CLOSE.RATE_LIMITED, 'Room capacity exceeded');
        return;
      }

      room.attach(client, {
        userId: payload.userId,
        userName: payload.userName,
        role: payload.role,
        linkId: payload.linkId,
      });

      client.on('message', (raw: Buffer) => {
        if (raw.byteLength > LIMITS.MAX_MESSAGE_BYTES) {
          client.close(WS_CLOSE.RATE_LIMITED, 'Message exceeds 1MB limit');
          return;
        }
        this.metrics.incrementSyncMessages();
        room.handleMessage(client, new Uint8Array(raw));
      });
    } catch {
      this.unregisterConnection(client, payload.userId);
      if (client.readyState === WebSocket.OPEN) {
        client.close(WS_CLOSE.RESTART, 'Failed to initialize session');
      }
    }
  }

  private isOriginAllowed(origin?: string): boolean {
    if (!origin) return true;
    const allowed = this.config.get('ALLOWED_ORIGINS', { infer: true });
    return allowed.includes(origin);
  }

  private extractTicket(rawUrl?: string): string | null {
    const parsed = new URL(rawUrl || '', 'http://localhost');
    return parsed.searchParams.get('ticket');
  }

  private isUserRateLimited(userId: string): boolean {
    const current = this.userConnectionCounts.get(userId) ?? 0;
    return current >= LIMITS.MAX_CONNECTIONS_PER_USER;
  }

  private registerConnection(client: WebSocket, userId: string, boardId: string): void {
    const currentConns = this.userConnectionCounts.get(userId) ?? 0;
    this.userConnectionCounts.set(userId, currentConns + 1);
    this.socketContexts.set(client, {
      userId,
      boardId,
      isAlive: true,
    });
    this.metrics.setActiveConnections(this.socketContexts.size);
  }

  private unregisterConnection(client: WebSocket, userId: string): void {
    if (!this.socketContexts.has(client)) return;
    this.decrementUserConnection(userId);
    this.socketContexts.delete(client);
    this.metrics.setActiveConnections(this.socketContexts.size);
  }

  private decrementUserConnection(userId: string): void {
    const current = this.userConnectionCounts.get(userId) ?? 1;
    if (current <= 1) {
      this.userConnectionCounts.delete(userId);
      return;
    }
    this.userConnectionCounts.set(userId, current - 1);
  }

  handleDisconnect(client: WebSocket): void {
    const ctx = this.socketContexts.get(client);
    if (!ctx) return;

    this.unregisterConnection(client, ctx.userId);

    const activeRoom = this.roomManager.getActiveRoom(ctx.boardId);
    if (activeRoom) {
      activeRoom.detach(client);
      this.roomManager.scheduleUnload(ctx.boardId);
    }
  }
}
