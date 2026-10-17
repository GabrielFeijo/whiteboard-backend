import { Module } from '@nestjs/common';
import { AppConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/database/prisma.module';
import { HealthModule } from './core/observability/health/health.module';
import { MetricsModule } from './core/observability/metrics/metrics.module';
import { RedisModule } from './core/redis/redis.module';
import { CollabFeatureModule } from './modules/collab/collab.module';
import { PersistenceModule } from './modules/persistence/persistence.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    PersistenceModule,
    MetricsModule,
    CollabFeatureModule,
  ],
})
export class CollabModule {}
