import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { CreateLinkDto } from '../dto/create-link.dto';
import { BoardShareLinksService, CreatedShareLinkResult } from './board-share-links.service';
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
  @ApiResponse({ status: 201, description: 'Share link generated with raw token' })
  @ApiResponse({ status: 400, description: 'Invalid role or expiration parameters' })
  @ApiResponse({ status: 403, description: 'Forbidden - only owner or editor can create links' })
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
  @ApiResponse({ status: 200, description: 'List of active share links' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied' })
  async listShareLinks(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<ShareLinkSummaryRecord[]> {
    return this.boardShareLinksService.listShareLinks(id, userId);
  }

  @Delete(':linkId')
  @RequireBoardRoles('OWNER')
  @ApiOperation({ summary: 'Revoke a share link' })
  @ApiResponse({ status: 200, description: 'Share link revoked and ACL revocation broadcast' })
  @ApiResponse({ status: 403, description: 'Forbidden - only owner can revoke links' })
  @ApiResponse({ status: 404, description: 'Share link not found' })
  async revokeShareLink(
    @Param('id', ParseCuidPipe) id: string,
    @Param('linkId', ParseCuidPipe) linkId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ShareLinkRecord> {
    return this.boardShareLinksService.revokeShareLink(id, linkId, userId);
  }
}
