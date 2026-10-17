import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { CreateLinkDto } from '../dto/create-link.dto';
import {
  BoardShareLinksService,
  CreatedShareLinkResult,
} from './board-share-links.service';
import { ShareLinkRecord, ShareLinkSummaryRecord } from './share-links.repository';

@ApiTags('boards')
@Controller('boards/:id/links')
@UseGuards(JwtAuthGuard, BoardAccessGuard)
@ApiBearerAuth()
export class BoardShareLinksController {
  constructor(private readonly boardShareLinksService: BoardShareLinksService) {}

  @Post()
  @RequireBoardRoles('OWNER', 'EDITOR')
  @ApiOperation({ summary: 'Generate a public share link' })
  async createShareLink(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLinkDto,
  ): Promise<CreatedShareLinkResult> {
    return this.boardShareLinksService.createShareLink(id, userId, dto);
  }

  @Get()
  @RequireBoardRoles('OWNER', 'EDITOR', 'VIEWER')
  @ApiOperation({ summary: 'List active share links' })
  async listShareLinks(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ShareLinkSummaryRecord[]> {
    return this.boardShareLinksService.listShareLinks(id, userId);
  }

  @Delete(':linkId')
  @RequireBoardRoles('OWNER')
  @ApiOperation({ summary: 'Revoke a share link' })
  async revokeShareLink(
    @Param('id', ParseCuidPipe) id: string,
    @Param('linkId', ParseCuidPipe) linkId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ShareLinkRecord> {
    return this.boardShareLinksService.revokeShareLink(id, linkId, userId);
  }
}
