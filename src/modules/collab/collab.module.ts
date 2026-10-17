import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { CollabGateway } from './collab.gateway';
import { RoomManagerService } from './room-manager.service';
import { YjsValidatorService } from './services/yjs-validator.service';
import { WsAuthService } from './ws-auth.service';

@Module({
  imports: [PersistenceModule],
  providers: [YjsValidatorService, WsAuthService, RoomManagerService, CollabGateway],
  exports: [YjsValidatorService, WsAuthService, RoomManagerService],
})
export class CollabFeatureModule {}
