import { Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from '../../src/common/middlewares/request-context.middleware';
import { SecurityHeadersMiddleware } from '../../src/common/middlewares/security-headers.middleware';
import { AppConfigModule } from '../../src/core/config/config.module';
import { PrismaService } from '../../src/core/database/prisma.service';
import { HealthModule } from '../../src/core/observability/health/health.module';
import { MetricsModule } from '../../src/core/observability/metrics/metrics.module';
import { RedisService } from '../../src/core/redis/redis.service';
import { S3StorageService } from '../../src/core/storage/s3-storage.service';
import { AssetsModule } from '../../src/modules/assets/assets.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { BoardsModule } from '../../src/modules/boards/boards.module';
import { Role } from '../../src/shared';

describe('API REST End-to-End Pipeline Integration', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  const users = new Map<
    string,
    {
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      deletedAt: Date | null;
      createdAt: Date;
    }
  >();
  const refreshTokens = new Map<
    string,
    {
      id: string;
      userId: string;
      familyId: string;
      tokenHash: string;
      expiresAt: Date;
      usedAt: Date | null;
      revokedAt: Date | null;
    }
  >();
  const boards = new Map<
    string,
    {
      id: string;
      title: string;
      ownerId: string;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }
  >();
  const boardMembers = new Map<string, { boardId: string; userId: string; role: Role }>();
  const shareLinks = new Map<
    string,
    {
      id: string;
      boardId: string;
      tokenHash: string;
      role: Role;
      expiresAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
    }
  >();
  const snapshots = new Map<
    string,
    { id: string; boardId: string; data: Buffer; version: number; reason: string; createdAt: Date }
  >();
  const redisStore = new Map<string, string>();
  const publishedChannels: Array<{ channel: string; message: string }> = [];

  const mockPrisma = {
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: vi.fn(async (cb: unknown) => {
      if (typeof cb === 'function') {
        return (cb as (tx: unknown) => unknown)(mockPrisma);
      }
      return Promise.all(cb as Promise<unknown>[]);
    }),
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) {
          for (const u of users.values()) {
            if (u.email === where.email) return { ...u };
          }
        }
        if (where.id) {
          const u = users.get(where.id);
          return u ? { ...u } : null;
        }
        return null;
      }),
      create: vi.fn(
        async ({ data }: { data: { email: string; name: string; passwordHash: string } }) => {
          const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
          const user = { id, ...data, deletedAt: null, createdAt: new Date() };
          users.set(id, user);
          return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const user = users.get(where.id);
          if (!user) throw new Error('Record not found');
          Object.assign(user, data);
          return { ...user };
        },
      ),
    },
    refreshToken: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { userId: string; familyId: string; tokenHash: string; expiresAt: Date };
        }) => {
          const id = `rt_${crypto.randomUUID().slice(0, 12)}`;
          const record = { id, ...data, usedAt: null, revokedAt: null };
          refreshTokens.set(data.tokenHash, record);
          return record;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        const rt = refreshTokens.get(where.tokenHash);
        if (!rt) return null;
        const user = users.get(rt.userId);
        return { ...rt, user: user ? { ...user } : null };
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const rt of refreshTokens.values()) {
            if (rt.id === where.id) {
              Object.assign(rt, data);
              return { ...rt };
            }
          }
          throw new Error('Record not found');
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { familyId?: string; tokenHash?: string; userId?: string };
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const rt of refreshTokens.values()) {
            if (
              (where.familyId && rt.familyId === where.familyId) ||
              (where.tokenHash && rt.tokenHash === where.tokenHash) ||
              (where.userId && rt.userId === where.userId)
            ) {
              Object.assign(rt, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    board: {
      create: vi.fn(async ({ data }: { data: { title: string; ownerId: string } }) => {
        const id = `brd_${crypto.randomUUID().slice(0, 12)}`;
        const board = {
          id,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        boards.set(id, board);
        return { ...board };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; deletedAt?: unknown } }) => {
        const board = boards.get(where.id);
        if (!board || (where.deletedAt === null && board.deletedAt !== null)) {
          return null;
        }
        const membersList = Array.from(boardMembers.values())
          .filter((m) => m.boardId === board.id)
          .map((m) => {
            const u = users.get(m.userId);
            return {
              boardId: m.boardId,
              userId: m.userId,
              role: m.role,
              user: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: null } : undefined,
            };
          });
        const owner = users.get(board.ownerId);
        return {
          ...board,
          owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : undefined,
          members: membersList,
        };
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { members?: { some?: { userId: string } }; deletedAt?: unknown };
          take: number;
        }) => {
          const uid = where.members?.some?.userId;
          const result = [];
          for (const board of boards.values()) {
            if (board.deletedAt !== null) continue;
            const membership = boardMembers.get(`${board.id}:${uid}`);
            if (membership) {
              result.push({
                ...board,
                members: [{ role: membership.role }],
                _count: {
                  members: Array.from(boardMembers.values()).filter((m) => m.boardId === board.id)
                    .length,
                },
              });
            }
            if (result.length >= take) break;
          }
          return result;
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const board = boards.get(where.id);
          if (!board) throw new Error('Board not found');
          Object.assign(board, data, { updatedAt: new Date() });
          return { ...board };
        },
      ),
    },
    boardMember: {
      create: vi.fn(async ({ data }: { data: { boardId: string; userId: string; role: Role } }) => {
        boardMembers.set(`${data.boardId}:${data.userId}`, { ...data });
        return { ...data };
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { boardId_userId: { boardId: string; userId: string } };
          create: { boardId: string; userId: string; role: Role };
          update: { role: Role };
        }) => {
          const key = `${where.boardId_userId.boardId}:${where.boardId_userId.userId}`;
          const existing = boardMembers.get(key);
          const data = existing ? { ...existing, role: update.role } : { ...create };
          boardMembers.set(key, data);
          const u = users.get(data.userId);
          return {
            ...data,
            user: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: null } : null,
          };
        },
      ),
      findMany: vi.fn(async ({ where }: { where: { boardId: string } }) => {
        return Array.from(boardMembers.values())
          .filter((m) => m.boardId === where.boardId)
          .map((m) => {
            const u = users.get(m.userId);
            return {
              ...m,
              user: u ? { id: u.id, name: u.name, email: u.email, avatarUrl: null } : null,
            };
          });
      }),
      delete: vi.fn(
        async ({ where }: { where: { boardId_userId: { boardId: string; userId: string } } }) => {
          const key = `${where.boardId_userId.boardId}:${where.boardId_userId.userId}`;
          const item = boardMembers.get(key);
          if (!item) throw new Error('Member not found');
          boardMembers.delete(key);
          return { ...item };
        },
      ),
    },
    shareLink: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { boardId: string; tokenHash: string; role: Role; expiresAt: Date | null };
        }) => {
          const id = `lnk_${crypto.randomUUID().slice(0, 12)}`;
          const link = { id, ...data, revokedAt: null, createdAt: new Date() };
          shareLinks.set(data.tokenHash, link);
          return { ...link };
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => {
        return shareLinks.get(where.tokenHash) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: { boardId: string; revokedAt?: unknown } }) => {
        return Array.from(shareLinks.values())
          .filter(
            (l) =>
              l.boardId === where.boardId &&
              (where.revokedAt === null ? l.revokedAt === null : true),
          )
          .map((l) => ({ id: l.id, role: l.role, createdAt: l.createdAt, expiresAt: l.expiresAt }));
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; boardId?: string };
          data: Record<string, unknown>;
        }) => {
          for (const l of shareLinks.values()) {
            if (l.id === where.id) {
              Object.assign(l, data);
              return { ...l };
            }
          }
          throw new Error('Share link not found');
        },
      ),
    },
    snapshot: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { boardId: string; data: Buffer; version: number; reason: string };
        }) => {
          const id = `snp_${crypto.randomUUID().slice(0, 12)}`;
          const rec = { id, ...data, createdAt: new Date() };
          snapshots.set(id, rec);
          return { ...rec };
        },
      ),
      findFirst: vi.fn(async ({ where }: { where: { boardId: string; id?: string } }) => {
        if (where.id) return snapshots.get(where.id) ?? null;
        let latest: {
          id: string;
          boardId: string;
          data: Buffer;
          version: number;
          reason: string;
          createdAt: Date;
        } | null = null;
        for (const s of snapshots.values()) {
          if (s.boardId === where.boardId) {
            if (!latest || s.version > latest.version) latest = s;
          }
        }
        return latest;
      }),
      findMany: vi.fn(async ({ where }: { where: { boardId: string } }) => {
        return Array.from(snapshots.values()).filter((s) => s.boardId === where.boardId);
      }),
    },
  };

  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
    client: {
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => {
        redisStore.set(k, v);
        return 'OK';
      }),
      del: vi.fn(async (k: string) => {
        const existed = redisStore.has(k);
        redisStore.delete(k);
        return existed ? 1 : 0;
      }),
      incr: vi.fn(async (k: string) => {
        const current = Number(redisStore.get(k) ?? 0) + 1;
        redisStore.set(k, String(current));
        return current;
      }),
      expire: vi.fn().mockResolvedValue(1),
      call: vi.fn(async (cmd: string, key: string) => {
        if (cmd === 'GETDEL') {
          const val = redisStore.get(key) ?? null;
          redisStore.delete(key);
          return val;
        }
        return null;
      }),
      publish: vi.fn(async (channel: string, message: string) => {
        publishedChannels.push({ channel, message });
        return 1;
      }),
    },
  };

  const mockS3 = {
    createPresignedPutUrl: vi.fn().mockResolvedValue({
      uploadUrl: 'https://s3.local/upload/dummy',
      assetUrl: 'https://s3.local/assets/dummy.png',
      key: 'boards/b1/dummy.png',
      expiresIn: 300,
    }),
  };

  @Global()
  @Module({
    providers: [
      { provide: PrismaService, useValue: mockPrisma },
      { provide: RedisService, useValue: mockRedis },
      { provide: S3StorageService, useValue: mockS3 },
    ],
    exports: [PrismaService, RedisService, S3StorageService],
  })
  class TestInfrastructureModule {}

  @Module({
    imports: [
      TestInfrastructureModule,
      AppConfigModule,
      HealthModule,
      MetricsModule,
      AuthModule,
      BoardsModule,
      AssetsModule,
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
  class TestAppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware).forRoutes('*');
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.API_PORT = '0';
    process.env.COLLAB_PORT = '0';
    process.env.DATABASE_URL = 'postgresql://wb:wb@localhost:5442/whiteboard';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.JWT_ACCESS_SECRET = 'test-jwt-secret-minimum-32-characters-super-secure';
    process.env.JWT_ACCESS_TTL = '900';
    process.env.REFRESH_COOKIE_NAME = 'wb_refresh';
    process.env.REFRESH_TOKEN_TTL_DAYS = '7';
    process.env.WS_TICKET_TTL = '30';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_BUCKET = 'whiteboard-assets';
    process.env.S3_ACCESS_KEY = 'minio';
    process.env.S3_SECRET_KEY = 'minio12345';
    process.env.S3_REGION = 'us-east-1';

    app = await NestFactory.create<NestExpressApplication>(TestAppModule, {
      logger: false,
    });

    app.disable('x-powered-by');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.setGlobalPrefix('v1', { exclude: ['health/(.*)', 'health', 'metrics'] });

    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  interface ApiResponsePayload {
    id: string;
    title: string;
    status: string | number;
    statusCode: number;
    detail: string;
    requestId: string;
    accessToken: string;
    refreshToken: string;
    role: string;
    token: string;
    ticket: string;
    boardId: string;
    ownerId: string;
    deletedAt: Date | string | null;
    email: string;
    name: string;
    items: Array<{ id: string; role: string }>;
    user: { email: string; name?: string };
    info: { postgres: { status: string }; redis: { status: string } };
  }

  const readJson = async (res: Response): Promise<ApiResponsePayload> => {
    return (await res.json()) as ApiResponsePayload;
  };

  describe('Security Headers, Correlation ID & Observability', () => {
    it('sets X-Request-Id and OWASP security headers on all responses', async () => {
      const res = await fetch(`${baseUrl}/health/live`, {
        headers: { 'x-request-id': 'test-correlation-client-1' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('x-request-id')).toBe('test-correlation-client-1');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    });

    it('returns 200 OK on /health/live and /health/ready', async () => {
      const liveRes = await fetch(`${baseUrl}/health/live`);
      expect(liveRes.status).toBe(200);
      const liveData = await readJson(liveRes);
      expect(liveData).toEqual({ status: 'ok' });

      const readyRes = await fetch(`${baseUrl}/health/ready`);
      expect(readyRes.status).toBe(200);
      const readyData = await readJson(readyRes);
      expect(readyData.status).toBe('ok');
      expect(readyData.info.postgres.status).toBe('up');
      expect(readyData.info.redis.status).toBe('up');
    });

    it('exports Prometheus formatted metrics on /metrics', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const text = await res.text();
      expect(text).toContain('whiteboard_http_requests_total');
      expect(text).toContain('whiteboard_active_rooms');
    });
  });

  describe('Authentication Full Lifecycle', () => {
    let accessToken: string;
    let refreshToken: string;

    it('registers a new user and issues auth tokens and HttpOnly cookie', async () => {
      const res = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@integration.local',
          password: 'Password123!',
          name: 'Alice Integration',
        }),
      });

      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.user.email).toBe('alice@integration.local');
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(res.headers.get('set-cookie')).toContain('wb_refresh=');

      accessToken = body.accessToken;
      refreshToken = body.refreshToken;
    });

    it('returns RFC 7807 problem details when attempting to register a duplicate email', async () => {
      const res = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@integration.local',
          password: 'Password123!',
          name: 'Alice Duplicate',
        }),
      });

      expect(res.status).toBe(409);
      const problem = await readJson(res);
      expect(problem.status).toBe(409);
      expect(problem.statusCode).toBe(409);
      expect(problem.title).toBe('Conflict');
      expect(problem.detail).toBe('Email address already registered');

      expect(problem.requestId).toBeDefined();
    });

    it('fails login with invalid password', async () => {
      const res = await fetch(`${baseUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice@integration.local',
          password: 'WrongPassword!',
        }),
      });

      expect(res.status).toBe(401);
      const problem = await readJson(res);
      expect(problem.detail).toBe('Invalid email or password');
    });

    it('fetches current user profile with valid JWT Bearer', async () => {
      const res = await fetch(`${baseUrl}/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      expect(res.status).toBe(200);
      const profile = await readJson(res);
      expect(profile.email).toBe('alice@integration.local');
      expect(profile.name).toBe('Alice Integration');
    });

    it('rotates refresh token via /v1/auth/refresh', async () => {
      const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      expect(res.status).toBe(200);
      const rotated = await readJson(res);
      expect(rotated.accessToken).toBeDefined();
      expect(rotated.refreshToken).toBeDefined();
      expect(rotated.refreshToken).not.toBe(refreshToken);

      accessToken = rotated.accessToken;
      refreshToken = rotated.refreshToken;
    });
  });

  describe('Boards Domain Full Lifecycle & RBAC', () => {
    let aliceToken: string;
    let bobToken: string;
    let boardId: string;
    let shareToken: string;

    beforeAll(async () => {
      const aRes = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.board@test.local',
          password: 'Password123!',
          name: 'Alice Owner',
        }),
      });
      const aBody = await readJson(aRes);
      aliceToken = aBody.accessToken;

      const bRes = await fetch(`${baseUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bob.board@test.local',
          password: 'Password123!',
          name: 'Bob Editor',
        }),
      });
      const bBody = await readJson(bRes);
      bobToken = bBody.accessToken;
    });

    it('creates a new board and assigns creator as OWNER', async () => {
      const res = await fetch(`${baseUrl}/v1/boards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ title: 'Sprint 2026 Board' }),
      });

      expect(res.status).toBe(201);
      const board = await readJson(res);
      expect(board.id).toBeDefined();
      expect(board.title).toBe('Sprint 2026 Board');
      boardId = board.id;
    });

    it('lists accessible boards with cursor pagination', async () => {
      const res = await fetch(`${baseUrl}/v1/boards?limit=10`, {
        headers: { Authorization: `Bearer ${aliceToken}` },
      });

      expect(res.status).toBe(200);
      const list = await readJson(res);
      expect(list.items.length).toBeGreaterThanOrEqual(1);
      expect(list.items[0].id).toBe(boardId);
      expect(list.items[0].role).toBe('OWNER');
    });

    it('renames a board via PATCH /v1/boards/:id', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ title: 'Sprint 2026 - Renamed' }),
      });

      expect(res.status).toBe(200);
      const updated = await readJson(res);
      expect(updated.title).toBe('Sprint 2026 - Renamed');
    });

    it('adds a member directly by email as EDITOR', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          email: 'bob.board@test.local',
          role: 'EDITOR',
        }),
      });

      expect(res.status).toBe(201);
      const member = await readJson(res);
      expect(member.role).toBe('EDITOR');
      expect(member.user.email).toBe('bob.board@test.local');
    });

    it('rejects adding member with role OWNER via validation', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          email: 'bob.board@test.local',
          role: 'OWNER',
        }),
      });

      expect(res.status).toBe(400);
      const problem = await readJson(res);
      expect(problem.status).toBe(400);
      expect(problem.detail).toContain('Role must be either VIEWER or EDITOR');
    });

    it('generates a public share link', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}/links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({ role: 'EDITOR', expiresInHours: 12 }),
      });

      expect(res.status).toBe(201);
      const link = await readJson(res);
      expect(link.token).toBeDefined();
      expect(link.role).toBe('EDITOR');
      shareToken = link.token;
    });

    it('allows anonymous guest to read board via share link token', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}?token=${shareToken}`);
      expect(res.status).toBe(200);
      const board = await readJson(res);
      expect(board.id).toBe(boardId);
      expect(board.role).toBe('EDITOR');
    });

    it('issues single-use WebSocket ticket for authenticated member', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}/ws-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const ticketResult = await readJson(res);
      expect(ticketResult.ticket).toMatch(/^wst_/);
      expect(ticketResult.boardId).toBe(boardId);
      expect(ticketResult.role).toBe('EDITOR');
    });

    it('duplicates a board for Bob', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}/duplicate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bobToken}`,
        },
      });

      expect(res.status).toBe(201);
      const copy = await readJson(res);
      expect(copy.title).toBe('Copy of Sprint 2026 - Renamed');
      expect(copy.ownerId).toBeDefined();
    });

    it('soft-deletes board when requested by OWNER', async () => {
      const res = await fetch(`${baseUrl}/v1/boards/${boardId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${aliceToken}`,
        },
      });

      expect(res.status).toBe(200);
      const deleted = await readJson(res);
      expect(deleted.deletedAt).toBeDefined();
    });
  });
});
