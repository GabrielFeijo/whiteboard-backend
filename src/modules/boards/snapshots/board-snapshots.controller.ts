import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { Role } from '../../../shared';
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
  @RequireBoardRoles(Role.OWNER, Role.EDITOR, Role.VIEWER)
  @ApiOperation({ summary: 'List historical snapshots of a board' })
  @ApiResponse({ status: 200, description: 'List of snapshots with version and metadata' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied' })
  async listSnapshots(
    @Param('id', ParseCuidPipe) boardId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SnapshotListItem[]> {
    return this.boardSnapshotsService.listSnapshots(boardId, userId);
  }

  @Post()
  @RequireBoardRoles(Role.OWNER, Role.EDITOR)
  @ApiOperation({ summary: 'Create a manual snapshot of the current board state' })
  @ApiResponse({ status: 201, description: 'Manual snapshot created' })
  @ApiResponse({ status: 403, description: 'Forbidden - viewers cannot create snapshots' })
  async createSnapshot(
    @Param('id', ParseCuidPipe) boardId: string,
    @CurrentUser('id') userId: string,
  ): Promise<SnapshotListItem> {
    return this.boardSnapshotsService.createManualSnapshot(boardId, userId);
  }

  @Post(':snapshotId/restore')
  @RequireBoardRoles(Role.OWNER, Role.EDITOR)
  @ApiOperation({ summary: 'Restore board canvas from a snapshot' })
  @ApiResponse({ status: 200, description: 'Snapshot restored and published to connected clients' })
  @ApiResponse({ status: 403, description: 'Forbidden - viewers cannot restore snapshots' })
  @ApiResponse({ status: 404, description: 'Snapshot not found' })
  async restoreSnapshot(
    @Param('id', ParseCuidPipe) boardId: string,
    @Param('snapshotId', ParseCuidPipe) snapshotId: string,
    @CurrentUser('id') userId: string,
  ): Promise<RestoreSnapshotResult> {
    return this.boardSnapshotsService.restoreSnapshot(boardId, snapshotId, userId);
  }
}
