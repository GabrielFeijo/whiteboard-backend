import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/** Módulo raiz do Collab Server (WebSocket, stateful por sala). Gateway entra no Épico 3. */
@Module({ imports: [AppConfigModule, PrismaModule, RedisModule, HealthModule] })
export class CollabModule {}
