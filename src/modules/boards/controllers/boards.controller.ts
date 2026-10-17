import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { CreateBoardDto } from '../dto/create-board.dto';
import { FindBoardQueryDto } from '../dto/find-board-query.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { UpdateBoardDto } from '../dto/update-board.dto';
import { BoardRecord } from '../repositories/boards.repository';
import { ResolvedBoardWithRole } from '../services/board-acl.service';
import { BoardsService, PaginatedBoardsResult } from '../services/boards.service';

@ApiTags('boards')
@Controller('boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new board' })
  @ApiResponse({ status: 201, description: 'Board created successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBoardDto,
  ): Promise<BoardRecord> {
    return this.boardsService.create(userId, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List accessible boards with cursor pagination' })
  @ApiResponse({ status: 200, description: 'List of accessible boards with cursor metadata' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedBoardsResult> {
    return this.boardsService.findAll(userId, query.cursor, query.limit);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get board details and membership metadata' })
  @ApiResponse({ status: 200, description: 'Board metadata with resolved access role' })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - authentication or share token required',
  })
  @ApiResponse({ status: 403, description: 'Forbidden - non-member without valid share token' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async findOne(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Query() query: FindBoardQueryDto,
  ): Promise<ResolvedBoardWithRole> {
    return this.boardsService.findOne(id, user?.id, query.token);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, BoardAccessGuard)
  @RequireBoardRoles('OWNER', 'EDITOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Rename or update a board' })
  @ApiResponse({ status: 200, description: 'Board updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - only owner or editor can update' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async update(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateBoardDto,
  ): Promise<BoardRecord> {
    return this.boardsService.update(id, userId, dto);
  }

  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard, BoardAccessGuard)
  @RequireBoardRoles('OWNER', 'EDITOR', 'VIEWER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Duplicate a board and its latest snapshot' })
  @ApiResponse({ status: 201, description: 'Board duplicated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - access denied' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async duplicate(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<BoardRecord> {
    return this.boardsService.duplicate(id, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, BoardAccessGuard)
  @RequireBoardRoles('OWNER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Soft-delete a board (owner only)' })
  @ApiResponse({ status: 200, description: 'Board soft-deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - only board owner can delete' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async remove(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<BoardRecord> {
    return this.boardsService.remove(id, userId);
  }
}
