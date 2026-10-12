import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AssetsService } from '../../src/assets/assets.service';
import { ConfigService } from '@nestjs/config';
import { BoardsService } from '../../src/boards/boards.service';

describe('AssetsService', () => {
  const mockConfig = {
    get: vi.fn((key: string) => {
      const map: Record<string, string> = {
        S3_ENDPOINT: 'http://localhost:9000',
        S3_BUCKET: 'whiteboard-assets',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY: 'minioadmin',
        S3_SECRET_KEY: 'minioadmin',
      };
      return map[key];
    }),
  } as unknown as ConfigService<any, true>;

  it('rejects upload presign if user is a VIEWER', async () => {
    const mockBoardsService = {
      findOne: vi.fn().mockResolvedValue({
        id: 'board-1',
        currentUserRole: 'VIEWER',
      }),
    } as unknown as BoardsService;

    const service = new AssetsService(mockConfig, mockBoardsService);

    await expect(
      service.createPresignedUploadUrl('board-1', 'user-viewer', {
        filename: 'image.png',
        contentType: 'image/png',
        size: 1024,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('generates presigned upload url and public asset url for EDITOR', async () => {
    const mockBoardsService = {
      findOne: vi.fn().mockResolvedValue({
        id: 'board-1',
        currentUserRole: 'EDITOR',
      }),
    } as unknown as BoardsService;

    const service = new AssetsService(mockConfig, mockBoardsService);

    const result = await service.createPresignedUploadUrl('board-1', 'user-editor', {
      filename: 'photo.jpg',
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
