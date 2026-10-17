import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { LoggingInterceptor } from '../../src/common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from '../../src/common/middlewares/request-context.middleware';
import { SecurityHeadersMiddleware } from '../../src/common/middlewares/security-headers.middleware';
import { AuthenticatedRequest } from '../../src/common/types/express-request.interface';
import { Env } from '../../src/core/config/env';

describe('Security Middlewares & Interceptors', () => {
  describe('RequestContextMiddleware', () => {
    const middleware = new RequestContextMiddleware();

    it('preserves valid alphanumeric x-request-id from incoming request', () => {
      const req = {
        headers: { 'x-request-id': 'custom-req-id-12345' },
      } as unknown as AuthenticatedRequest;

      const setHeaderMock = vi.fn();
      const res = { setHeader: setHeaderMock } as unknown as Response;
      const next = vi.fn();

      middleware.use(req, res, next);

      expect(req.requestId).toBe('custom-req-id-12345');
      expect(setHeaderMock).toHaveBeenCalledWith('X-Request-Id', 'custom-req-id-12345');
      expect(next).toHaveBeenCalledOnce();
    });

    it('generates a fresh UUID when incoming x-request-id is missing or contains invalid characters', () => {
      const req = {
        headers: { 'x-request-id': '<script>alert(1)</script>' },
      } as unknown as AuthenticatedRequest;

      const setHeaderMock = vi.fn();
      const res = { setHeader: setHeaderMock } as unknown as Response;
      const next = vi.fn();

      middleware.use(req, res, next);

      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(setHeaderMock).toHaveBeenCalledWith('X-Request-Id', req.requestId);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('SecurityHeadersMiddleware', () => {
    it('sets security headers including nosniff, DENY, and strict-origin', () => {
      const mockConfig = {
        get: vi.fn().mockReturnValue('development'),
      } as unknown as ConfigService<Env, true>;

      const middleware = new SecurityHeadersMiddleware(mockConfig);
      const headersSet: Record<string, string> = {};

      const res = {
        setHeader: vi.fn((k: string, v: string) => {
          headersSet[k] = v;
        }),
      } as unknown as Response;
      const next = vi.fn();

      middleware.use({} as Request, res, next);

      expect(headersSet['X-Content-Type-Options']).toBe('nosniff');
      expect(headersSet['X-Frame-Options']).toBe('DENY');
      expect(headersSet['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headersSet['X-Permitted-Cross-Domain-Policies']).toBe('none');
      expect(headersSet['Strict-Transport-Security']).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    });

    it('enables Strict-Transport-Security in production mode', () => {
      const mockConfig = {
        get: vi.fn().mockReturnValue('production'),
      } as unknown as ConfigService<Env, true>;

      const middleware = new SecurityHeadersMiddleware(mockConfig);
      const headersSet: Record<string, string> = {};

      const res = {
        setHeader: vi.fn((k: string, v: string) => {
          headersSet[k] = v;
        }),
      } as unknown as Response;
      const next = vi.fn();

      middleware.use({} as Request, res, next);

      expect(headersSet['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    });
  });

  describe('LoggingInterceptor', () => {
    it('logs HTTP requests with method, sanitized path without query parameters, and requestId', async () => {
      const interceptor = new LoggingInterceptor();
      const logSpy = vi.spyOn(
        (interceptor as unknown as { logger: { log: (msg: string) => void } }).logger,
        'log',
      );

      const mockReq = {
        method: 'GET',
        url: '/v1/boards/b1?token=secret-token-value',
        originalUrl: '/v1/boards/b1?token=secret-token-value',
        requestId: 'test-req-id-999',
      };
      const mockRes = { statusCode: 200 };

      const context = {
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => mockReq,
          getResponse: () => mockRes,
        }),
      } as unknown as ExecutionContext;

      const callHandler = {
        handle: () => of({ ok: true }),
      };

      await new Promise<void>((resolve) => {
        interceptor.intercept(context, callHandler).subscribe({
          complete: () => resolve(),
        });
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/GET \/v1\/boards\/b1 200 - \d+ms \[reqId=test-req-id-999\]/),
      );
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('secret-token-value'));
    });
  });
});
