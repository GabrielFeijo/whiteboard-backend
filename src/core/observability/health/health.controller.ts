import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        const i = this.indicator.check('postgres');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return i.up();
        } catch (e) {
          return i.down({ message: e instanceof Error ? e.message : 'Postgres check failed' });
        }
      },
      async () => {
        const i = this.indicator.check('redis');
        try {
          await this.redis.ping();
          return i.up();
        } catch (e) {
          return i.down({ message: e instanceof Error ? e.message : 'Redis check failed' });
        }
      },
    ]);
  }
}
