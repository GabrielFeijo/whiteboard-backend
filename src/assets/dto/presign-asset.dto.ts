import { IsIn, IsInt, IsNotEmpty, IsPositive, IsString, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export class PresignAssetDto {
  @ApiProperty({ description: 'Asset file name', example: 'diagram.png' })
  @IsString()
  @IsNotEmpty()
  filename!: string;

  @ApiProperty({
    description: 'MIME type of the asset',
    example: 'image/png',
    enum: ALLOWED_MIME_TYPES,
  })
  @IsString()
  @IsIn(ALLOWED_MIME_TYPES)
  contentType!: (typeof ALLOWED_MIME_TYPES)[number];

  @ApiProperty({
    description: 'File size in bytes (max 10MB)',
    example: 102400,
  })
  @IsInt()
  @IsPositive()
  @Max(10 * 1024 * 1024, { message: 'Asset file size must not exceed 10MB' })
  size!: number;
}
