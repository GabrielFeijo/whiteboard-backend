import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(HealthIndicatorService) private readonly indicator: HealthIndicatorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /** Liveness: o processo está de pé. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: só libera o pod após conectar ao PostgreSQL e ao Redis (doc §19). */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      async () => {
        const i = this.indicator.check('postgres');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return i.up();
        } catch (e) {
          return i.down({ message: (e as Error).message });
        }
      },
      async () => {
        const i = this.indicator.check('redis');
        try {
          await this.redis.ping();
          return i.up();
        } catch (e) {
          return i.down({ message: (e as Error).message });
        }
      },
    ]);
  }
}
