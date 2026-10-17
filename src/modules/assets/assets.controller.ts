import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireBoardRoles } from '../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { PresignedUploadResult } from '../../core/storage/s3-storage.service';
import { AssetsService } from './assets.service';
import { PresignAssetDto } from './dto/presign-asset.dto';

@ApiTags('assets')
@Controller('boards/:boardId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('presign')
  @UseGuards(JwtAuthGuard, BoardAccessGuard)
  @RequireBoardRoles('OWNER', 'EDITOR')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a presigned S3/MinIO PUT upload URL for an asset' })
  @ApiResponse({ status: 201, description: 'Presigned PUT URL generated successfully' })
  @ApiResponse({ status: 400, description: 'Unsupported MIME type or invalid payload' })
  @ApiResponse({ status: 403, description: 'Forbidden - viewers cannot upload assets' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async presign(
    @Param('boardId', ParseCuidPipe) boardId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PresignAssetDto,
  ): Promise<PresignedUploadResult> {
    return this.assetsService.createPresignedUploadUrl(boardId, userId, dto);
  }
}
