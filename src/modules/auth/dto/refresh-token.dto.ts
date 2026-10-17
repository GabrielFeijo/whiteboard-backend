import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({ description: 'Refresh token if not sent via HttpOnly cookie' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
