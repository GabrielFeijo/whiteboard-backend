import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Role, ROLES } from '../../shared';

export class CreateLinkDto {
  @ApiPropertyOptional({ enum: ROLES, default: 'VIEWER' })
  @IsOptional()
  @IsEnum(ROLES)
  role?: Role = 'VIEWER';

  @ApiPropertyOptional({ description: 'Validity in hours (optional)', example: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720) // max 30 days
  expiresInHours?: number;
}
