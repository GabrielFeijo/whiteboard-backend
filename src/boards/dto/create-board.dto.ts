import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateBoardDto {
  @ApiProperty({ example: 'Sprint Planning Whiteboard' })
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MinLength(1)
  @MaxLength(100)
  title!: string;
}
