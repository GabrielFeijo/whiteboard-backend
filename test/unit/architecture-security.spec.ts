import {
  ArgumentsHost,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { BoardAccessGuard, BoardAclResolver } from '../../src/common/guards/board-access.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../src/common/guards/optional-jwt-auth.guard';
import { ParseCuidPipe } from '../../src/common/pipes/parse-cuid.pipe';
import { AuthenticatedRequest } from '../../src/common/types/express-request.interface';
import { Env } from '../../src/core/config/env';
import { PrismaService } from '../../src/core/database/prisma.service';
import { PersistenceService } from '../../src/modules/persistence/persistence.service';

describe('Architecture & Security Building Blocks (Filter, Guard, Pipe, Persistence)', () => {
  it('ParseCuidPipe accepts valid CUID/ID strings and rejects path traversal or malformed IDs', () => {
    const pipe = new ParseCuidPipe();
    expect(pipe.transform('cm2abc123def456')).toBe('cm2abc123def456');
    expect(() => pipe.transform('../etc/passwd')).toThrow(BadRequestException);
    expect(() => pipe.transform('')).toThrow(BadRequestException);
    expect(() => pipe.transform('id with spaces')).toThrow(BadRequestException);
  });

  it('GlobalExceptionFilter maps Prisma P2025 to 404 RFC 7807 Problem Details while keeping message/statusCode', () => {
    const filter = new GlobalExceptionFilter();
    const statusMock = vi.fn().mockReturnThis();
    const jsonMock = vi.fn();

    const mockReq = {
      method: 'DELETE',
      url: '/v1/boards/b1/links/nonexistent',
      originalUrl: '/v1/boards/b1/links/nonexistent',
      requestId: 'req-123',
    };
    const mockRes = {
      status: statusMock,
      json: jsonMock,
    };

    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockReq,
        getResponse: () => mockRes,
      }),
    } as unknown as ArgumentsHost;

    const prismaNotFound = new Prisma.PrismaClientKnownRequestError(
      'Record to delete does not exist.',
      { code: 'P2025', clientVersion: '6.0.0' },
    );

    filter.catch(prismaNotFound, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 404,
        statusCode: 404,
        title: 'Not Found',
        error: 'Not Found',
        requestId: 'req-123',
      }),
    );
  });

  it('BoardAccessGuard enforces @RequireBoardRoles and populates req.boardAccess', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(['OWNER', 'EDITOR']),
    } as unknown as Reflector;

    const resolver: BoardAclResolver = {
      resolveBoardAccess: vi.fn().mockResolvedValue({
        boardId: 'b1',
        title: 'Board 1',
        ownerId: 'u1',
        role: 'VIEWER',
        isAnonymous: false,
      }),
    };

    const guard = new BoardAccessGuard(reflector, resolver);
    const req: Partial<AuthenticatedRequest> = {
      params: { id: 'b1' },
      query: {},
      user: { id: 'u2', email: 'u2@example.com', name: 'User 2' },
    };

    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('PersistenceService restores buffered updates when Prisma createMany fails transiently', async () => {
    const createManyMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Transient DB connection drop'))
      .mockResolvedValueOnce({ count: 1 });

    const mockPrisma = {
      docUpdate: {
        createMany: createManyMock,
      },
    } as unknown as PrismaService;

    const persistence = new PersistenceService(mockPrisma);
    const sampleUpdate = new Uint8Array([1, 2, 3, 4]);
    persistence.queueUpdate('board-1', sampleUpdate);

    await expect(persistence.flushBoard('board-1')).rejects.toThrow('Transient DB connection drop');

    await persistence.flushBoard('board-1');
    expect(createManyMock).toHaveBeenCalledTimes(2);
  });

  it('JwtAuthGuard and OptionalJwtAuthGuard share bearer extraction and validate user schema', async () => {
    const validUser = { id: 'u1', email: 'u1@example.com', name: 'User 1' };
    const jwtService = {
      verifyAsync: vi
        .fn()
        .mockResolvedValueOnce(validUser)
        .mockRejectedValueOnce(new Error('jwt expired')),
    } as unknown as JwtService;
    const config = {
      get: vi.fn().mockReturnValue('secret'),
    } as unknown as ConfigService<Env, true>;

    const strictGuard = new JwtAuthGuard(jwtService, config);
    const optionalGuard = new OptionalJwtAuthGuard(jwtService, config);

    const authReq: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer valid-jwt-token' },
    };
    const authCtx = {
      switchToHttp: () => ({ getRequest: () => authReq }),
    } as unknown as ExecutionContext;

    await expect(strictGuard.canActivate(authCtx)).resolves.toBe(true);
    expect(authReq.user).toEqual(validUser);

    const expiredReq: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer expired-jwt-token' },
    };
    const expiredCtx = {
      switchToHttp: () => ({ getRequest: () => expiredReq }),
    } as unknown as ExecutionContext;

    await expect(optionalGuard.canActivate(expiredCtx)).resolves.toBe(true);
    expect(expiredReq.user).toBeUndefined();

    const missingHeaderCtx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as unknown as ExecutionContext;
    await expect(strictGuard.canActivate(missingHeaderCtx)).rejects.toThrow(UnauthorizedException);
  });
});
