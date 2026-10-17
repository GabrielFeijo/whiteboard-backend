import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Env } from '../../src/core/config/env';
import { PrismaService } from '../../src/core/database/prisma.service';
import { RedisService } from '../../src/core/redis/redis.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { RefreshTokenRepository } from '../../src/modules/auth/repositories/refresh-token.repository';
import { BruteForceService } from '../../src/modules/auth/services/brute-force.service';
import { UsersRepository } from '../../src/modules/users/users.repository';

interface MockPrismaClient {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  refreshToken: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
}

interface MockRedisWrapper {
  client: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: MockPrismaClient;
  let mockJwt: { signAsync: ReturnType<typeof vi.fn> };
  let mockConfig: ConfigService<Env, true>;
  let mockRedis: MockRedisWrapper;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      refreshToken: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn((cb: unknown) =>
        Array.isArray(cb) ? Promise.all(cb) : (cb as (tx: MockPrismaClient) => unknown)(mockPrisma),
      ),
    };
    mockJwt = {
      signAsync: vi.fn().mockResolvedValue('mock-jwt-token'),
    };
    mockConfig = {
      get: vi.fn((key: keyof Env) => {
        if (key === 'JWT_ACCESS_SECRET') return 'secret-must-be-32-characters-long!';
        if (key === 'JWT_ACCESS_TTL') return 900;
        if (key === 'REFRESH_TOKEN_TTL_DAYS') return 7;
        if (key === 'AUTH_LOCKOUT_TTL_SECONDS') return 900;
        if (key === 'AUTH_MAX_LOGIN_ATTEMPTS') return 5;
        return null;
      }),
    } as unknown as ConfigService<Env, true>;
    mockRedis = {
      client: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      },
    };

    const prismaService = mockPrisma as unknown as PrismaService;
    const redisService = mockRedis as unknown as RedisService;

    const usersRepository = new UsersRepository(prismaService);
    const refreshTokenRepository = new RefreshTokenRepository(prismaService);
    const bruteForceService = new BruteForceService(redisService, mockConfig);

    service = new AuthService(
      usersRepository,
      refreshTokenRepository,
      bruteForceService,
      mockJwt as unknown as JwtService,
      mockConfig,
    );
  });

  it('hashes passwords and registers a new user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
      name: 'Tester',
      createdAt: new Date(),
    });

    const res = await service.register({
      email: 'test@example.com',
      password: 'password123',
      name: 'Tester',
    });

    expect(res.user.email).toBe('test@example.com');
    expect(res.accessToken).toBe('mock-jwt-token');
    expect(res.refreshToken).toBeDefined();
    expect(mockPrisma.user.create).toHaveBeenCalledOnce();
  });

  it('throws ConflictException if email is already taken', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'taken@example.com' });

    await expect(
      service.register({
        email: 'taken@example.com',
        password: 'password123',
        name: 'Tester',
      }),
    ).rejects.toThrow('Email address already registered');
  });

  it('locks account in Redis after 5 failed login attempts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockRedis.client.incr.mockResolvedValue(5);

    await expect(
      service.login({ email: 'victim@example.com', password: 'wrong' }, '127.0.0.1'),
    ).rejects.toThrow(UnauthorizedException);

    expect(mockRedis.client.set).toHaveBeenCalledWith(
      'auth:lockout:victim@example.com',
      '1',
      'EX',
      900,
    );

    mockRedis.client.get.mockResolvedValue('1');
    await expect(
      service.login({ email: 'victim@example.com', password: 'wrong' }, '127.0.0.1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('revokes entire token family on refresh token reuse and rejects deactivated accounts', async () => {
    const rawToken = 'reused-refresh-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    mockPrisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt1',
      userId: 'u1',
      familyId: 'fam-1',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: new Date(Date.now() - 1_000),
      revokedAt: null,
      user: { id: 'u1', email: 'u1@example.com', name: 'User 1', deletedAt: null },
    });

    await expect(service.refresh(rawToken)).rejects.toThrow(
      'Refresh token reuse detected. Token family revoked.',
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'fam-1' },
      data: { revokedAt: expect.any(Date) },
    });

    mockPrisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt2',
      userId: 'u1',
      familyId: 'fam-2',
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      revokedAt: null,
      user: { id: 'u1', email: 'deleted_u1@whiteboard.local', name: 'Deleted User', deletedAt: new Date() },
    });

    await expect(service.refresh(rawToken)).rejects.toThrow('User account is deactivated');
  });
});
