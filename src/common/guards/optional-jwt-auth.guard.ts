import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../core/config/env';
import {
  AuthenticatedRequest,
  AuthenticatedUserSchema,
} from '../types/express-request.interface';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return true;
    }

    try {
      const rawPayload: unknown = await this.jwtService.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      const parsed = AuthenticatedUserSchema.safeParse(rawPayload);
      if (parsed.success) {
        request.user = parsed.data;
      }
    } catch {
      void 0;
    }

    return true;
  }
}
