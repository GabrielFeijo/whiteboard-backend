import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BoardsService } from './boards.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { CreateLinkDto } from './dto/create-link.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { WsTicketDto } from './dto/ws-ticket.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new board' })
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateBoardDto) {
    return this.boardsService.create(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List accessible boards with cursor pagination' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number,
  ) {
    return this.boardsService.findAll(userId, cursor, limit ? Number(limit) : undefined);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get board details and membership metadata' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
    @Query('token') token?: string,
  ) {
    return this.boardsService.findOne(id, user?.id, token);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rename or update a board' })
  async update(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateBoardDto,
  ) {
    return this.boardsService.update(id, userId, dto);
  }

  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Duplicate a board and its latest snapshot' })
  async duplicate(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.boardsService.duplicate(id, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a board (owner only)' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.boardsService.remove(id, userId);
  }

  @Post(':id/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a public share link' })
  async createShareLink(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateLinkDto,
  ) {
    return this.boardsService.createShareLink(id, userId, dto);
  }

  @Get(':id/links')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List active share links' })
  async listShareLinks(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.boardsService.listShareLinks(id, userId);
  }

  @Delete(':id/links/:linkId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a share link' })
  async revokeShareLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.boardsService.revokeShareLink(id, linkId, userId);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add or invite a member to the board by email' })
  async addMember(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.boardsService.addMember(id, userId, dto);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all members of the board' })
  async listMembers(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.boardsService.listMembers(id, userId);
  }

  @Delete(':id/members/:memberUserId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a member from the board' })
  async removeMember(
    @Param('id') id: string,
    @Param('memberUserId') memberUserId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.boardsService.removeMember(id, memberUserId, userId);
  }

  @Post(':id/ws-ticket')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a single-use WebSocket ticket (TTL 30s)' })
  async issueWsTicket(
    @Param('id') boardId: string,
    @Body() dto: WsTicketDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.boardsService.issueWsTicket(boardId, user, dto?.token);
  }

  @Get(':id/snapshots')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List historical snapshots of a board' })
  async listSnapshots(@Param('id') boardId: string, @CurrentUser('id') userId: string) {
    return this.boardsService.listSnapshots(boardId, userId);
  }

  @Post(':id/snapshots/:snapshotId/restore')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restore board canvas from a snapshot' })
  async restoreSnapshot(
    @Param('id') boardId: string,
    @Param('snapshotId') snapshotId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.boardsService.restoreSnapshot(boardId, snapshotId, userId);
  }
}
