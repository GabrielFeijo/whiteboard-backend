import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import {
  BoardSnapshotsService,
  RestoreSnapshotResult,
  SnapshotListItem,
} from './board-snapshots.service';

@ApiTags('boards')
@Controller('boards/:id/snapshots')
@UseGuards(JwtAuthGuard, BoardAccessGuard)
@ApiBearerAuth()
export class BoardSnapshotsController {
  constructor(private readonly boardSnapshotsService: BoardSnapshotsService) {}

  @Get()
  @RequireBoardRoles('OWNER', 'EDITOR', 'VIEWER')
  @ApiOperation({ summary: 'List historical snapshots of a board' })
  async listSnapshots(
    @Param('id', ParseCuidPipe) boardId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SnapshotListItem[]> {
    return this.boardSnapshotsService.listSnapshots(boardId, userId);
  }

  @Post(':snapshotId/restore')
  @RequireBoardRoles('OWNER', 'EDITOR')
  @ApiOperation({ summary: 'Restore board canvas from a snapshot' })
  async restoreSnapshot(
    @Param('id', ParseCuidPipe) boardId: string,
    @Param('snapshotId', ParseCuidPipe) snapshotId: string,
    @CurrentUser('id') userId: string,
  ): Promise<RestoreSnapshotResult> {
    return this.boardSnapshotsService.restoreSnapshot(boardId, snapshotId, userId);
  }
}
