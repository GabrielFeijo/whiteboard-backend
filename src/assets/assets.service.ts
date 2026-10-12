import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import * as path from 'node:path';
import { Env } from '../config/env';
import { BoardsService } from '../boards/boards.service';
import { PresignAssetDto } from './dto/presign-asset.dto';

@Injectable()
export class AssetsService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly boardsService: BoardsService,
  ) {
    this.endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    this.bucket = this.config.get('S3_BUCKET', { infer: true });

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region: this.config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: this.config.get('S3_SECRET_KEY', { infer: true }),
      },
      forcePathStyle: true,
    });
  }

  async createPresignedUploadUrl(
    boardId: string,
    userId: string,
    dto: PresignAssetDto,
  ) {
    const board = await this.boardsService.findOne(boardId, userId);
    if (board.currentUserRole === 'VIEWER') {
      throw new ForbiddenException('Viewers cannot upload assets');
    }

    const rawExt = path.extname(dto.filename).replace(/^\./, '').toLowerCase();
    const ext = rawExt || (dto.contentType === 'image/png' ? 'png' : 'jpg');
    const key = `boards/${boardId}/${nanoid(16)}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: dto.contentType,
      ContentLength: dto.size,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 300, // 5 minutes
    });

    const assetUrl = `${this.endpoint}/${this.bucket}/${key}`;

    return {
      uploadUrl,
      assetUrl,
      key,
      expiresIn: 300,
    };
  }
}
