import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Env, NodeEnv } from '../../../core/config/env';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private isSecureRequest(req?: Request): boolean {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === NodeEnv.PRODUCTION;
    const host = req?.headers.host ?? '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');
    return isProd && !isLocalhost;
  }

  setRefreshCookie(res: Response, token: string, req?: Request): void {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) ?? 7;

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: this.isSecureRequest(req),
      sameSite: 'lax',
      path: '/',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    });
  }

  clearRefreshCookie(res: Response, req?: Request): void {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });

    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: this.isSecureRequest(req),
      sameSite: 'lax',
      path: '/',
    });
  }

  extractRefreshToken(req: Request, dtoRefreshToken?: string): string | undefined {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const fromCookie = cookies?.[cookieName];
    if (typeof fromCookie === 'string' && fromCookie.length > 0) {
      return fromCookie;
    }
    if (typeof dtoRefreshToken === 'string' && dtoRefreshToken.length > 0) {
      return dtoRefreshToken;
    }
    return undefined;
  }
}
