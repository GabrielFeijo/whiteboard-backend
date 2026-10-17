import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from '../../src/common/middlewares/request-context.middleware';
import { SecurityHeadersMiddleware } from '../../src/common/middlewares/security-headers.middleware';
import { validateEnv } from '../../src/core/config/env';
import { PrismaService } from '../../src/core/database/prisma.service';
import { HealthModule } from '../../src/core/observability/health/health.module';
import { MetricsModule } from '../../src/core/observability/metrics/metrics.module';
import { RedisService } from '../../src/core/redis/redis.service';
import { CollabFeatureModule } from '../../src/modules/collab/collab.module';
import { PersistenceModule } from '../../src/modules/persistence/persistence.module';
import { MSG, WS_CLOSE } from '../../src/shared';

describe('Collab Server Stateful & WebSocket Pipeline Integration', () => {
  let app: NestExpressApplication;
  let httpUrl: string;
  let wsUrl: string;

  const tickets = new Map<string, string>();
  const queuedUpdates: Array<{ boardId: string; update: Uint8Array }> = [];
  const messageListeners: Array<(channel: string, message: string) => void> = [];

  const mockRedisClient = {
    call: vi.fn(async (cmd: string, key: string) => {
      if (cmd === 'GETDEL') {
        const val = tickets.get(key) ?? null;
        tickets.delete(key);
        return val;
      }
      return null;
    }),
    get: vi.fn(async () => null),
    set: vi.fn(async (k: string, v: string) => {
      tickets.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async () => 1),
    publish: vi.fn(async (channel: string, message: string) => {
      for (const cb of messageListeners) {
        cb(channel, message);
      }
      return 1;
    }),
    on: vi.fn(),
  };

  const mockSubscriberClient = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'message') {
        messageListeners.push(handler as (channel: string, message: string) => void);
      }
    }),
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  };

  const mockRedis = {
    client: mockRedisClient,
    duplicate: vi.fn().mockReturnValue(mockSubscriberClient),
    ping: vi.fn().mockResolvedValue('PONG'),
  };

  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    snapshot: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'snp-1', createdAt: new Date() }),
    },
    docUpdate: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi
        .fn()
        .mockImplementation((args: { data: Array<{ boardId: string; data: Buffer }> }) => {
          for (const item of args.data) {
            queuedUpdates.push({ boardId: item.boardId, update: new Uint8Array(item.data) });
          }
          return { count: args.data.length };
        }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };

  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: mockPrisma },
      { provide: RedisService, useValue: mockRedis },
    ],
    exports: [PrismaService, RedisService],
  })
  class TestCollabInfraModule {}

  @Module({
    imports: [
      TestCollabInfraModule,
      ConfigModule.forRoot({
        isGlobal: true,
        validate: validateEnv,
        load: [
          () => ({
            NODE_ENV: 'test',
            API_PORT: 0,
            COLLAB_PORT: 0,
            DATABASE_URL: 'postgresql://wb:wb@localhost:5442/whiteboard',
            REDIS_URL: 'redis://localhost:6379',
            JWT_ACCESS_SECRET: 'test-jwt-secret-minimum-32-characters-super-secure',
            JWT_ACCESS_TTL: 900,
            REFRESH_COOKIE_NAME: 'wb_refresh',
            REFRESH_TOKEN_TTL_DAYS: 7,
            WS_TICKET_TTL: 30,
            ALLOWED_ORIGINS: 'http://localhost:3000',
            S3_ENDPOINT: 'http://localhost:9000',
            S3_BUCKET: 'whiteboard-assets',
            S3_ACCESS_KEY: 'minio',
            S3_SECRET_KEY: 'minio12345',
            S3_REGION: 'us-east-1',
          }),
        ],
      }),
      HealthModule,
      MetricsModule,
      PersistenceModule,
      CollabFeatureModule,
    ],
    providers: [
      {
        provide: APP_FILTER,
        useClass: GlobalExceptionFilter,
      },
      {
        provide: APP_INTERCEPTOR,
        useClass: LoggingInterceptor,
      },
    ],
  })
  class TestCollabModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware).forRoutes('*');
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TestCollabModule, {
      logger: false,
    });

    app.disable('x-powered-by');
    app.useWebSocketAdapter(new WsAdapter(app));

    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Collab HTTP Health & Metrics', () => {
    it('responds to /health/live and /metrics on Collab server port', async () => {
      const liveRes = await fetch(`${httpUrl}/health/live`);
      expect(liveRes.status).toBe(200);
      expect(await liveRes.json()).toEqual({ status: 'ok' });

      const metricsRes = await fetch(`${httpUrl}/metrics`);
      expect(metricsRes.status).toBe(200);
      const text = await metricsRes.text();
      expect(text).toContain('whiteboard_active_rooms');
    });
  });

  describe('Collab WebSocket Connection & Auth Flow', () => {
    it('rejects connection without ticket parameter with 4401 UNAUTHORIZED', async () => {
      const ws = new WebSocket(wsUrl);

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(WS_CLOSE.UNAUTHORIZED);
      expect(closeEvent.reason).toBe('Ticket required');
    });

    it('rejects connection with invalid or expired ticket with 4401 UNAUTHORIZED', async () => {
      const ws = new WebSocket(`${wsUrl}?ticket=wst_invalid_fake_token`);

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(WS_CLOSE.UNAUTHORIZED);
      expect(closeEvent.reason).toBe('Invalid or expired ticket');
    });

    it('successfully connects with valid ticket and receives initial SyncStep1 message', async () => {
      const validTicket = 'wst_valid_ticket_integration_1';
      tickets.set(
        `ws:ticket:${validTicket}`,
        JSON.stringify({
          userId: 'alice-collab-1',
          userName: 'Alice Collab',
          boardId: 'board-integration-1',
          role: 'EDITOR',
        }),
      );

      const ws = new WebSocket(`${wsUrl}?ticket=${validTicket}`);

      const firstMessage = await new Promise<Buffer>((resolve, reject) => {
        ws.on('message', (data: Buffer) => resolve(data));
        ws.on('error', reject);
        ws.on('close', (code) => reject(new Error(`Closed unexpectedly with code ${code}`)));
      });

      expect(firstMessage).toBeDefined();
      expect(firstMessage[0]).toBe(MSG.SYNC);

      ws.close();
    });

    it('disconnects connected client when Redis ACL event revokes access in real-time', async () => {
      const ticket = 'wst_valid_ticket_revocation_test';
      tickets.set(
        `ws:ticket:${ticket}`,
        JSON.stringify({
          userId: 'revoked-user-99',
          userName: 'Revoked User',
          boardId: 'board-acl-test',
          role: 'EDITOR',
          linkId: 'link-to-revoke-1',
        }),
      );

      const ws = new WebSocket(`${wsUrl}?ticket=${ticket}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('message', () => resolve());
        ws.on('error', reject);
      });

      // Simulate Redis ACL publish event
      const aclPayload = JSON.stringify({ type: 'REVOKE_LINK', linkId: 'link-to-revoke-1' });
      for (const cb of messageListeners) {
        cb('board:board-acl-test:acl', aclPayload);
      }

      const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      expect(closeEvent.code).toBe(WS_CLOSE.FORBIDDEN);
      expect(closeEvent.reason).toBe('Access revoked');
    });
  });
});
