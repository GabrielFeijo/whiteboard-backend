import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
    this.boardAclService.assertCanEdit(board, 'Viewers cannot upload assets');

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

  async createPresignedDownloadUrl(
    boardId: string,
    userId: string | undefined,
    rawKey: string,
    shareToken?: string,
  ): Promise<{ readUrl: string; expiresIn: number }> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId, shareToken);

    const safeFilename = rawKey.replace(/^\/+/, '').replace(`boards/${boardId}/`, '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(safeFilename) || safeFilename.includes('..')) {
      throw new BadRequestException('Invalid asset key');
    }

    const key = `boards/${boardId}/${safeFilename}`;
    const expiresIn = 900;
    const readUrl = await this.s3Storage.createPresignedGetUrl(key, expiresIn);

    return { readUrl, expiresIn };
  }
}
