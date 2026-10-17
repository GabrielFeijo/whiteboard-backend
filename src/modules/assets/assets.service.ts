import { ForbiddenException, Injectable } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PresignedUploadResult, S3StorageService } from '../../core/storage/s3-storage.service';
import { BoardAclService } from '../boards/services/board-acl.service';
import { MIME_TO_EXTENSION, PresignAssetDto } from './dto/presign-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly s3Storage: S3StorageService,
    private readonly boardAclService: BoardAclService,
  ) {}

  async createPresignedUploadUrl(
    boardId: string,
    userId: string,
    dto: PresignAssetDto,
  ): Promise<PresignedUploadResult> {
    const board = await this.boardAclService.resolveBoardWithAccess(boardId, userId);
    if (board.currentUserRole === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot upload assets');
    }

    const ext = MIME_TO_EXTENSION[dto.contentType];
    if (!ext) {
      throw new ForbiddenException('Unsupported asset MIME type');
    }

    const key = `boards/${boardId}/${nanoid(16)}.${ext}`;

    return this.s3Storage.createPresignedPutUrl({
      key,
      contentType: dto.contentType,
      contentLength: dto.size,
      expiresInSeconds: 300,
    });
  }
}
