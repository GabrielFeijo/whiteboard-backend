import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { Role } from '../../../shared';
import { AddMemberDto } from '../dto/add-member.dto';
import { BoardMemberWithUserRecord } from './board-members.repository';
import { BoardMembersService } from './board-members.service';

@ApiTags('boards')
@Controller('boards/:id/members')
@UseGuards(JwtAuthGuard, BoardAccessGuard)
@ApiBearerAuth()
export class BoardMembersController {
  constructor(private readonly boardMembersService: BoardMembersService) {}

  @Post()
  @RequireBoardRoles('OWNER')
  @ApiOperation({ summary: 'Add or invite a member to the board by email' })
  async addMember(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddMemberDto,
  ): Promise<BoardMemberWithUserRecord> {
    return this.boardMembersService.addMember(id, userId, dto);
  }

  @Get()
  @RequireBoardRoles('OWNER', 'EDITOR', 'VIEWER')
  @ApiOperation({ summary: 'List all members of the board' })
  async listMembers(
    @Param('id', ParseCuidPipe) id: string,
    @CurrentUser('id') userId: string,
  ): Promise<BoardMemberWithUserRecord[]> {
    return this.boardMembersService.listMembers(id, userId);
  }

  @Delete(':memberUserId')
  @RequireBoardRoles('OWNER')
  @ApiOperation({ summary: 'Remove a member from the board' })
  async removeMember(
    @Param('id', ParseCuidPipe) id: string,
    @Param('memberUserId', ParseCuidPipe) memberUserId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ boardId: string; userId: string; role: Role }> {
    return this.boardMembersService.removeMember(id, memberUserId, userId);
  }
}
