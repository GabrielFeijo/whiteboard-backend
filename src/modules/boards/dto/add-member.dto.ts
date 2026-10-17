import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty } from 'class-validator';
import { Role } from '../../../shared';

export const INVITEABLE_ROLES: readonly Role[] = ['VIEWER', 'EDITOR'];

export class AddMemberDto {
  @ApiProperty({ description: 'User email to invite', example: 'collab@example.com' })
  @IsEmail({}, { message: 'Invalid email address' })
  @IsNotEmpty({ message: 'Email cannot be empty' })
  email!: string;

  @ApiProperty({ enum: ['VIEWER', 'EDITOR'], default: 'VIEWER' })
  @IsIn(['VIEWER', 'EDITOR'], { message: 'Role must be either VIEWER or EDITOR' })
  role!: Role;
}
