import { CanActivate, ExecutionContext, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '../../core/config/env';
import { RedisService } from '../../core/redis/redis.service';
import { AuthenticatedRequest } from '../types/express-request.interface';
import { extractBearerToken, verifyBearerToken } from './jwt-token.helper';

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request);

    if (!token) {
      return true;
    }

    try {
      request.user = await verifyBearerToken(token, this.jwtService, this.config, this.redis);
    } catch (err) {
      this.logger.debug(
        `Optional bearer token ignored: ${err instanceof Error ? err.message : 'invalid token'}`,
      );
    }

    return true;
  }
}
