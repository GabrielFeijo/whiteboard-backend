import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class WsTicketDto {
  @ApiPropertyOptional({ description: 'Public share link token if joining anonymously' })
  @IsOptional()
  @IsString()
  token?: string;
}
