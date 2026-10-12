import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AssetsService } from './assets.service';
import { PresignAssetDto } from './dto/presign-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('assets')
@Controller('boards/:boardId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('presign')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a presigned S3/MinIO PUT upload URL for an asset' })
  async presign(
    @Param('boardId') boardId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PresignAssetDto,
  ) {
    return this.assetsService.createPresignedUploadUrl(boardId, userId, dto);
  }
}
