import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from './common/middlewares/request-context.middleware';
import { SecurityHeadersMiddleware } from './common/middlewares/security-headers.middleware';
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
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class CollabModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware).forRoutes('*');
  }
}
