import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString, Max, MaxLength } from 'class-validator';

export const AllowedAssetMimeType = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  GIF: 'image/gif',
} as const;
export type AllowedAssetMimeType = (typeof AllowedAssetMimeType)[keyof typeof AllowedAssetMimeType];

export const ALLOWED_ASSET_MIME_TYPES = [
  AllowedAssetMimeType.JPEG,
  AllowedAssetMimeType.PNG,
  AllowedAssetMimeType.WEBP,
  AllowedAssetMimeType.GIF,
] as const;

export const MIME_TO_EXTENSION: Readonly<Record<AllowedAssetMimeType, string>> = {
  [AllowedAssetMimeType.JPEG]: 'jpg',
  [AllowedAssetMimeType.PNG]: 'png',
  [AllowedAssetMimeType.WEBP]: 'webp',
  [AllowedAssetMimeType.GIF]: 'gif',
};

export class PresignAssetDto {
  @ApiProperty({ description: 'Asset file name', example: 'diagram.png' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    description: 'MIME type of the asset (raster images only; SVG blocked for XSS prevention)',
    example: 'image/png',
    enum: ALLOWED_ASSET_MIME_TYPES,
  })
  @IsString()
  @IsIn(ALLOWED_ASSET_MIME_TYPES)
  contentType!: AllowedAssetMimeType;

  @ApiProperty({
    description: 'File size in bytes (max 10MB)',
    example: 102400,
  })
  @IsInt()
  @IsPositive()
  @Max(10 * 1024 * 1024, { message: 'Asset file size must not exceed 10MB' })
  size!: number;
}
