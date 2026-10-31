import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
  readUrl?: string;
  key: string;
  expiresIn: number;
}

@Injectable()
export class S3StorageService {
  private readonly s3Client: S3Client;
  private readonly publicS3Client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicEndpoint: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.endpoint = this.config.get('S3_ENDPOINT', { infer: true });
    this.publicEndpoint =
      this.config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? this.endpoint;
    this.bucket = this.config.get('S3_BUCKET', { infer: true });

    const region = this.config.get('S3_REGION', { infer: true });
    const credentials = {
      accessKeyId: this.config.get('S3_ACCESS_KEY', { infer: true }),
      secretAccessKey: this.config.get('S3_SECRET_KEY', { infer: true }),
    };

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials,
      forcePathStyle: true,
    });

    this.publicS3Client =
      this.publicEndpoint !== this.endpoint
        ? new S3Client({
            endpoint: this.publicEndpoint,
            region,
            credentials,
            forcePathStyle: true,
          })
        : this.s3Client;
  }

  async createPresignedPutUrl(params: PresignedUploadParams): Promise<PresignedUploadResult> {
    const expiresIn = params.expiresInSeconds ?? 300;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
    });

    const uploadUrl = await getSignedUrl(this.publicS3Client, command, {
      expiresIn,
    });

    const assetUrl = `${this.publicEndpoint.replace(/\/$/, '')}/${this.bucket}/${params.key}`;
    const readUrl = await this.createPresignedGetUrl(params.key, expiresIn);

    return {
      uploadUrl,
      assetUrl,
      readUrl,
      key: params.key,
      expiresIn,
    };
  }

  async createPresignedGetUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.publicS3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async getObject(
    key: string,
  ): Promise<{ buffer: Buffer; stream?: Readable; contentType: string; contentLength?: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    const body = response.Body;
    if (body instanceof Readable) {
      return {
        buffer: Buffer.alloc(0),
        stream: body,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength,
      };
    }

    const byteArray = await body?.transformToByteArray();

    return {
      buffer: Buffer.from(byteArray ?? []),
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength,
    };
  }
}
