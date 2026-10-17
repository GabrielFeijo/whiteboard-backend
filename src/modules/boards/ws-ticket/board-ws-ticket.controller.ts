import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../../common/guards/optional-jwt-auth.guard';
import { ParseCuidPipe } from '../../../common/pipes/parse-cuid.pipe';
import { WsTicketDto } from '../dto/ws-ticket.dto';
import { BoardWsTicketService, IssuedWsTicketResult } from './board-ws-ticket.service';

@ApiTags('boards')
@Controller('boards/:id/ws-ticket')
export class BoardWsTicketController {
  constructor(private readonly boardWsTicketService: BoardWsTicketService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a single-use WebSocket ticket (TTL 30s)' })
  @ApiResponse({ status: 200, description: 'Single-use WebSocket ticket issued successfully' })
  @ApiResponse({ status: 400, description: 'Missing authentication or valid share link token' })
  @ApiResponse({ status: 403, description: 'Forbidden access to board' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async issueWsTicket(
    @Param('id', ParseCuidPipe) boardId: string,
    @Body() dto: WsTicketDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<IssuedWsTicketResult> {
    return this.boardWsTicketService.issueWsTicket(boardId, user, dto?.token);
  }
}
