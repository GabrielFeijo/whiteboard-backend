import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestContextMiddleware } from './common/middlewares/request-context.middleware';
import { SecurityHeadersMiddleware } from './common/middlewares/security-headers.middleware';
import { AppConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/database/prisma.module';
import { HealthModule } from './core/observability/health/health.module';
import { MetricsModule } from './core/observability/metrics/metrics.module';
import { RedisModule } from './core/redis/redis.module';
import { S3Module } from './core/storage/s3.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { BoardsModule } from './modules/boards/boards.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    S3Module,
    HealthModule,
    MetricsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    AuthModule,
    BoardsModule,
    AssetsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, SecurityHeadersMiddleware).forRoutes('*');
  }
}
