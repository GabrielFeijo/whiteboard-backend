import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/modules/auth/auth.service';
import { RefreshTokenRepository } from '../../src/modules/auth/repositories/refresh-token.repository';
import { BruteForceService } from '../../src/modules/auth/services/brute-force.service';
import { Env } from '../../src/core/config/env';
import { UsersRepository } from '../../src/modules/users/users.repository';

describe('Auth Concurrency and Atomic Token Rotation', () => {
  let authService: AuthService;
  let mockUsersRepo: {
    findByEmail: ReturnType<typeof vi.fn>;
    findActiveProfileById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    anonymizeAndSoftDelete: ReturnType<typeof vi.fn>;
  };
  let mockTokenRepo: {
    create: ReturnType<typeof vi.fn>;
    findByHashWithUser: ReturnType<typeof vi.fn>;
    markAsUsed: ReturnType<typeof vi.fn>;
    markAsUsedAtomic: ReturnType<typeof vi.fn>;
    revokeFamily: ReturnType<typeof vi.fn>;
    revokeByHash: ReturnType<typeof vi.fn>;
  };
  let mockBruteForce: {
    assertNotLocked: ReturnType<typeof vi.fn>;
    recordFailedAttempt: ReturnType<typeof vi.fn>;
    clearAttempts: ReturnType<typeof vi.fn>;
  };
  let mockJwt: {
    signAsync: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockUsersRepo = {
      findByEmail: vi.fn(),
      findActiveProfileById: vi.fn(),
      create: vi.fn(),
      anonymizeAndSoftDelete: vi.fn(),
    };
    mockTokenRepo = {
      create: vi.fn().mockResolvedValue(undefined),
      findByHashWithUser: vi.fn(),
      markAsUsed: vi.fn().mockResolvedValue(undefined),
      markAsUsedAtomic: vi.fn(),
      revokeFamily: vi.fn().mockResolvedValue(undefined),
      revokeByHash: vi.fn().mockResolvedValue(undefined),
    };
    mockBruteForce = {
      assertNotLocked: vi.fn().mockResolvedValue(undefined),
      recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
      clearAttempts: vi.fn().mockResolvedValue(undefined),
    };
    mockJwt = {
      signAsync: vi.fn().mockResolvedValue('new-access-jwt'),
    };
    mockConfig = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL') return 900;
        if (key === 'REFRESH_TOKEN_TTL_DAYS') return 7;
        if (key === 'JWT_ACCESS_SECRET') return 'at-least-32-chars-secret-key-12345';
        return undefined;
      }),
    };

    authService = new AuthService(
      mockUsersRepo as unknown as UsersRepository,
      mockTokenRepo as unknown as RefreshTokenRepository,
      mockBruteForce as unknown as BruteForceService,
      mockJwt as unknown as JwtService,
      mockConfig as unknown as ConfigService<Env, true>,
    );
  });

  it('allows the first atomic consumer to rotate tokens while rejecting concurrent race safely', async () => {
    const rawToken = 'race-token-12345';
    const futureDate = new Date(Date.now() + 60_000);

    mockTokenRepo.findByHashWithUser.mockResolvedValue({
      id: 'token-rec-1',
      userId: 'u1',
      familyId: 'family-1',
      tokenHash: 'hash-1',
      expiresAt: futureDate,
      usedAt: null,
      revokedAt: null,
      user: {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
      },
    });

    mockTokenRepo.markAsUsedAtomic.mockResolvedValueOnce(true);
    const firstResult = await authService.refresh(rawToken);

    expect(firstResult.accessToken).toBe('new-access-jwt');
    expect(mockTokenRepo.revokeFamily).not.toHaveBeenCalled();

    mockTokenRepo.markAsUsedAtomic.mockResolvedValueOnce(false);
    await expect(authService.refresh(rawToken)).rejects.toThrow(
      new UnauthorizedException('Refresh token already consumed'),
    );

    expect(mockTokenRepo.revokeFamily).not.toHaveBeenCalled();
  });
});
