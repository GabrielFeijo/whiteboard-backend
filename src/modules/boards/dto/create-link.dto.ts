import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role } from '../../../shared';

export const SHARE_LINK_ROLES = [Role.VIEWER, Role.EDITOR] as const;

export class CreateLinkDto {
  @ApiPropertyOptional({ enum: SHARE_LINK_ROLES, default: Role.VIEWER })
  @IsOptional()
  @IsIn(SHARE_LINK_ROLES, { message: 'Share link role must be either VIEWER or EDITOR' })
  role?: Role = Role.VIEWER;

  @ApiPropertyOptional({ description: 'Validity in hours (optional)', example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}
