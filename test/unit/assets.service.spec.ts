import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { Env } from '../../src/core/config/env';
import { S3StorageService } from '../../src/core/storage/s3-storage.service';
import { AssetsService } from '../../src/modules/assets/assets.service';
import { BoardAclService } from '../../src/modules/boards/services/board-acl.service';

describe('AssetsService', () => {
  const mockConfig = {
    get: vi.fn((key: keyof Env) => {
      const map: Record<string, string> = {
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'whiteboard-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: 'minioadmin',
        S3_SECRET_KEY: 'minioadmin',
      };
      return map[key];
    }),
  } as unknown as ConfigService<Env, true>;

  const s3Storage = new S3StorageService(mockConfig);

  it('rejects upload presign if user is a VIEWER', async () => {
    const mockBoardAcl = {
      resolveBoardWithAccess: vi.fn().mockResolvedValue({
        id: 'board-1',
        currentUserRole: 'VIEWER',
      }),
    } as unknown as BoardAclService;

    const service = new AssetsService(s3Storage, mockBoardAcl);

    await expect(
      service.createPresignedUploadUrl('board-1', 'user-viewer', {
        filename: 'image.png',
        contentType: 'image/png',
        size: 1024,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('generates presigned upload url and public asset url for EDITOR and ignores malicious filename extensions', async () => {
    const mockBoardAcl = {
      resolveBoardWithAccess: vi.fn().mockResolvedValue({
        id: 'board-1',
        currentUserRole: 'EDITOR',
      }),
    } as unknown as BoardAclService;

    const service = new AssetsService(s3Storage, mockBoardAcl);

    const result = await service.createPresignedUploadUrl('board-1', 'user-editor', {
      filename: 'exploit.html',
      contentType: 'image/jpeg',
      size: 50000,
    });

    expect(result.uploadUrl).toBeDefined();
    expect(result.uploadUrl).toContain('whiteboard-assets');
    expect(result.assetUrl).toBeDefined();
    expect(result.assetUrl).toContain('http://localhost:9000/whiteboard-assets/boards/board-1/');
    expect(result.key).toMatch(/^boards\/board-1\/.+\.jpg$/);
    expect(result.expiresIn).toBe(300);
  });
});
