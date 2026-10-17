import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Role, ROLES } from '../../../shared';

export class AddMemberDto {
  @ApiProperty({ description: 'User email to invite', example: 'collab@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ enum: ['VIEWER', 'EDITOR'], default: 'VIEWER' })
  @IsEnum(ROLES)
  role!: Role;
}
