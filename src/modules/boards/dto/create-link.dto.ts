import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '../../../shared';

export const SHARE_LINK_ROLES: readonly Role[] = ['VIEWER', 'EDITOR'];

export class CreateLinkDto {
  @ApiPropertyOptional({ enum: ['VIEWER', 'EDITOR'], default: 'VIEWER' })
  @IsOptional()
  @IsIn(['VIEWER', 'EDITOR'], { message: 'Share link role must be either VIEWER or EDITOR' })
  role?: Role = 'VIEWER';

  @ApiPropertyOptional({ description: 'Validity in hours (optional)', example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}
