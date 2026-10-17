import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FindBoardQueryDto {
  @ApiPropertyOptional({ description: 'Public share link token' })
  @IsOptional()
  @IsString()
  token?: string;
}
