import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { PersistenceModule } from './persistence/persistence.module';
import { WsAuthService } from './collab/ws-auth.service';
import { RoomManagerService } from './collab/room-manager.service';
import { CollabGateway } from './collab/collab.gateway';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    PersistenceModule,
  ],
  providers: [WsAuthService, RoomManagerService, CollabGateway],
})
export class CollabModule {}
