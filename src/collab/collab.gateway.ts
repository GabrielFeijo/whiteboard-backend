import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { IncomingMessage } from 'node:http';
import { WebSocket, Server } from 'ws';
import { ConfigService } from '@nestjs/config';
import { WsAuthService } from './ws-auth.service';
import { RoomManagerService } from './room-manager.service';
import { WS_CLOSE, LIMITS } from '../shared';
import { Env } from '../config/env';

import { MetricsService } from '../metrics/metrics.service';

interface ClientSocketContext {
  userId: string;
  boardId: string;
  isAlive: boolean;
}

@WebSocketGateway()
export class CollabGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private socketContexts = new Map<WebSocket, ClientSocketContext>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly wsAuth: WsAuthService,
    private readonly roomManager: RoomManagerService,
    private readonly config: ConfigService<Env, true>,
    private readonly metrics: MetricsService,
  ) {
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

  async handleConnection(client: WebSocket, req: IncomingMessage) {
    const origin = req.headers.origin;
    const allowed = this.config.get('ALLOWED_ORIGINS', { infer: true });
    if (origin && !allowed.includes(origin)) {
      client.close(WS_CLOSE.FORBIDDEN, 'Origin not allowed');
      return;
    }

    const url = new URL(req.url || '', 'http://localhost');
    const ticket = url.searchParams.get('ticket');
    if (!ticket) {
      client.close(WS_CLOSE.UNAUTHORIZED, 'Ticket required');
      return;
    }

    const payload = await this.wsAuth.consumeTicket(ticket);
    if (!payload) {
      client.close(WS_CLOSE.UNAUTHORIZED, 'Invalid or expired ticket');
      return;
    }

    let userConns = 0;
    for (const [, ctx] of this.socketContexts) {
      if (ctx.userId === payload.userId) userConns++;
    }
    if (userConns >= LIMITS.MAX_CONNECTIONS_PER_USER) {
      client.close(WS_CLOSE.RATE_LIMITED, 'Too many connections for user');
      return;
    }

    this.socketContexts.set(client, {
      userId: payload.userId,
      boardId: payload.boardId,
      isAlive: true,
    });
    this.metrics.setActiveConnections(this.socketContexts.size);

    client.on('pong', () => {
      const ctx = this.socketContexts.get(client);
      if (ctx) ctx.isAlive = true;
    });

    const room = await this.roomManager.getOrLoadRoom(payload.boardId);

    if (room.clients.size >= LIMITS.MAX_PARTICIPANTS_PER_BOARD) {
      client.close(WS_CLOSE.RATE_LIMITED, 'Room capacity exceeded');
      this.socketContexts.delete(client);
      this.metrics.setActiveConnections(this.socketContexts.size);
      return;
    }

    room.attach(client, {
      userId: payload.userId,
      userName: payload.userName,
      role: payload.role,
    });

    client.on('message', (raw: Buffer) => {
      if (raw.byteLength > LIMITS.MAX_MESSAGE_BYTES) {
        client.close(WS_CLOSE.RATE_LIMITED, 'Message exceeds 1MB limit');
        return;
      }
      this.metrics.incrementSyncMessages();
      room.handleMessage(client, new Uint8Array(raw));
    });
  }

  handleDisconnect(client: WebSocket) {
    const ctx = this.socketContexts.get(client);
    if (ctx) {
      this.socketContexts.delete(client);
      this.metrics.setActiveConnections(this.socketContexts.size);
      this.roomManager.getOrLoadRoom(ctx.boardId).then((room) => {
        room.detach(client);
        this.roomManager.scheduleUnload(ctx.boardId);
      });
    }
  }
}
