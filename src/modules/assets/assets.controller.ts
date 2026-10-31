import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequireBoardRoles } from '../../common/decorators/board-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BoardAccessGuard } from '../../common/guards/board-access.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { ParseCuidPipe } from '../../common/pipes/parse-cuid.pipe';
import { AuthenticatedRequest } from '../../common/types/express-request.interface';
import { PresignedUploadResult } from '../../core/storage/s3-storage.service';
import { Role } from '../../shared';
import { AssetsService } from './assets.service';
import { PresignAssetDto } from './dto/presign-asset.dto';

@ApiTags('assets')
@Controller('boards/:boardId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post('presign')
  @UseGuards(JwtAuthGuard, BoardAccessGuard)
  @RequireBoardRoles(Role.OWNER, Role.EDITOR)
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

  @Get(':assetKey/url')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Generate a presigned S3/MinIO GET read URL for an asset' })
  @ApiResponse({ status: 200, description: 'Presigned GET URL generated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Board not found' })
  async getReadUrl(
    @Param('boardId', ParseCuidPipe) boardId: string,
    @Param('assetKey') assetKey: string,
    @Req() req: AuthenticatedRequest,
    @Query('token') shareToken?: string,
  ): Promise<{ readUrl: string; expiresIn: number }> {
    return this.assetsService.createPresignedDownloadUrl(
      boardId,
      req.user?.id,
      assetKey,
      shareToken,
    );
  }

  @Get(':assetKey/view')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Stream authorized S3 asset binary for canvas rendering' })
  @ApiResponse({ status: 200, description: 'Asset binary stream returned' })
  async viewAsset(
    @Param('boardId', ParseCuidPipe) boardId: string,
    @Param('assetKey') assetKey: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
    @Query('token') shareToken?: string,
  ): Promise<void> {
    const { buffer, stream, contentType, contentLength } =
      await this.assetsService.downloadAssetObject(boardId, req.user?.id, assetKey, shareToken);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (contentLength !== undefined) {
      res.setHeader('Content-Length', String(contentLength));
    }

    if (stream) {
      res.status(200);
      stream.pipe(res);
      return;
    }

    res.status(200).send(buffer);
  }
}
