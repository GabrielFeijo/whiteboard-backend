import { Module } from '@nestjs/common';
import {
  BOARD_ACL_RESOLVER,
  BoardAccessGuard,
} from '../../common/guards/board-access.guard';
import { AuthModule } from '../auth/auth.module';
import { BoardsController } from './controllers/boards.controller';
import { BoardMembersController } from './members/board-members.controller';
import { BoardMembersRepository } from './members/board-members.repository';
import { BoardMembersService } from './members/board-members.service';
import { BoardsRepository } from './repositories/boards.repository';
import { BoardAclService } from './services/board-acl.service';
import { BoardsService } from './services/boards.service';
import { BoardShareLinksController } from './share-links/board-share-links.controller';
import { BoardShareLinksService } from './share-links/board-share-links.service';
import { ShareLinksRepository } from './share-links/share-links.repository';
import { BoardSnapshotsController } from './snapshots/board-snapshots.controller';
import { BoardSnapshotsService } from './snapshots/board-snapshots.service';
import { SnapshotsRepository } from './snapshots/snapshots.repository';
import { BoardWsTicketController } from './ws-ticket/board-ws-ticket.controller';
import { BoardWsTicketService } from './ws-ticket/board-ws-ticket.service';

@Module({
  imports: [AuthModule],
  controllers: [
    BoardsController,
    BoardMembersController,
    BoardShareLinksController,
    BoardSnapshotsController,
    BoardWsTicketController,
  ],
  providers: [
    BoardsRepository,
    BoardMembersRepository,
    ShareLinksRepository,
    SnapshotsRepository,
    BoardAclService,
    {
      provide: BOARD_ACL_RESOLVER,
      useExisting: BoardAclService,
    },
    BoardAccessGuard,
    BoardsService,
    BoardMembersService,
    BoardShareLinksService,
    BoardSnapshotsService,
    BoardWsTicketService,
  ],
  exports: [
    BoardAclService,
    BOARD_ACL_RESOLVER,
    BoardAccessGuard,
    BoardsService,
    BoardMembersService,
    BoardShareLinksService,
    BoardSnapshotsService,
    BoardWsTicketService,
  ],
})
export class BoardsModule {}
