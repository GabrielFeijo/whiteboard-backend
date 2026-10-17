import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../core/config/env';
import { redisKeys } from '../../../core/redis/redis-keys';
import { RedisService } from '../../../core/redis/redis.service';

@Injectable()
export class BruteForceService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async assertNotLocked(email: string): Promise<void> {
    const lockoutKey = redisKeys.authLockout(email);
    const isLocked = await this.redis.client.get(lockoutKey);
    if (isLocked) {
      throw new ForbiddenException(
        'Account temporarily locked due to failed attempts. Try again in 15 minutes.',
      );
    }
  }

  async recordFailedAttempt(email: string, ip: string): Promise<void> {
    const attemptsKey = redisKeys.authAttempts(email, ip);
    const lockoutKey = redisKeys.authLockout(email);
    const lockoutTtl = this.config.get('AUTH_LOCKOUT_TTL_SECONDS', { infer: true }) ?? 900;
    const maxAttempts = this.config.get('AUTH_MAX_LOGIN_ATTEMPTS', { infer: true }) ?? 5;

    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.client.expire(attemptsKey, lockoutTtl);
    }
    if (attempts >= maxAttempts) {
      await this.redis.client.set(lockoutKey, '1', 'EX', lockoutTtl);
    }
  }

  async clearAttempts(email: string, ip: string): Promise<void> {
    const attemptsKey = redisKeys.authAttempts(email, ip);
    await this.redis.client.del(attemptsKey);
  }
}
