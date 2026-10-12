import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService } from '../../src/auth/auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;
  let mockConfig: any;
  let mockRedis: any;

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
      $transaction: vi.fn((cb) => (Array.isArray(cb) ? Promise.all(cb) : cb(mockPrisma))),
    };
    mockJwt = {
      signAsync: vi.fn().mockResolvedValue('mock-jwt-token'),
    };
    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return 'secret-must-be-32-characters-long!';
        if (key === 'JWT_ACCESS_TTL') return 900;
        return null;
      }),
    };
    mockRedis = {
      client: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
        incr: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
      },
    };

    service = new AuthService(mockPrisma, mockJwt, mockConfig, mockRedis);
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
});
