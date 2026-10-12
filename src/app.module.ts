import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/** Módulo raiz da API REST (stateless). Épicos seguintes adicionam auth/boards/assets. */
@Module({ imports: [AppConfigModule, PrismaModule, RedisModule, HealthModule] })
export class AppModule {}
