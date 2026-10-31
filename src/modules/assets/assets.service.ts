import { Readable } from 'node:stream';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PresignedUploadResult, S3StorageService } from '../../core/storage/s3-storage.service';
import { BoardAclService } from '../boards/services/board-acl.service';
import {
  ALLOWED_ASSET_MIME_TYPES,
  AllowedAssetMimeType,
  MIME_TO_EXTENSION,
  PresignAssetDto,
} from './dto/presign-asset.dto';

const EXTENSION_TO_MIME: Readonly<Record<string, AllowedAssetMimeType>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    private readonly s3Storage: S3StorageService,
    private readonly boardAclService: BoardAclService,
  ) {}

  private resolveSafeStorageKey(boardId: string, rawKey: string): string {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawKey).replace(/^\/+/, '');
    } catch {
      throw new BadRequestException('Invalid URL-encoded asset key');
    }

    const safeFilename = decoded.replace(`boards/${boardId}/`, '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(safeFilename) || safeFilename.includes('..')) {
      throw new BadRequestException('Invalid asset key');
    }
    return `boards/${boardId}/${safeFilename}`;
  }

  private sanitizeAssetContentType(rawContentType: string, key: string): AllowedAssetMimeType {
    const normalized = rawContentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if ((ALLOWED_ASSET_MIME_TYPES as readonly string[]).includes(normalized)) {
      return normalized as AllowedAssetMimeType;
    }

    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    const inferred = EXTENSION_TO_MIME[ext];
    if (inferred && (normalized === '' || normalized === 'application/octet-stream')) {
      return inferred;
    }

    throw new ForbiddenException('Stored asset MIME type is not allowed');
  }

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

    const key = this.resolveSafeStorageKey(boardId, rawKey);
    const expiresIn = 900;
    const readUrl = await this.s3Storage.createPresignedGetUrl(key, expiresIn);

    return { readUrl, expiresIn };
  }

  async downloadAssetObject(
    boardId: string,
    userId: string | undefined,
    rawKey: string,
    shareToken?: string,
  ): Promise<{ buffer: Buffer; stream?: Readable; contentType: string; contentLength?: number }> {
    await this.boardAclService.resolveBoardWithAccess(boardId, userId, shareToken);
    const key = this.resolveSafeStorageKey(boardId, rawKey);

    let obj: { buffer: Buffer; stream?: Readable; contentType: string; contentLength?: number };
    try {
      obj = await this.s3Storage.getObject(key);
    } catch (err) {
      this.logger.warn(`Failed to fetch S3 object ${key}: ${err instanceof Error ? err.message : String(err)}`);
      throw new NotFoundException('Asset not found');
    }

    const safeContentType = this.sanitizeAssetContentType(obj.contentType, key);
    return {
      ...obj,
      contentType: safeContentType,
    };
  }
}
