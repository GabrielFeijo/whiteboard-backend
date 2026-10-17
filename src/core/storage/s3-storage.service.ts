import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Env } from '../config/env';

export interface PresignedUploadParams {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  assetUrl: string;
  key: string;
  expiresIn: number;
}

@Injectable()
export class S3StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;

  constructor(private readonly config: ConfigService<Env, true>) {
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

  async createPresignedPutUrl(params: PresignedUploadParams): Promise<PresignedUploadResult> {
    const expiresIn = params.expiresInSeconds ?? 300;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn,
    });

    const assetUrl = `${this.endpoint}/${this.bucket}/${params.key}`;

    return {
      uploadUrl,
      assetUrl,
      key: params.key,
      expiresIn,
    };
  }
}
