import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { Env } from '../../core/config/env';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  private readonly isProd: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.isProd = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (this.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  }
}
