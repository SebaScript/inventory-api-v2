import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** Trims surrounding whitespace so `"  "` is rejected as empty, not stored. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateGroupDto {
  @ApiProperty({
    example: 'Electronics',
    minLength: 2,
    maxLength: 80,
    description: 'Group name. Unique case-insensitively across all groups.',
  })
  @Transform(trim)
  @IsString()
  @Length(2, 80, { message: 'name must be between 2 and 80 characters' })
  name: string;

  @ApiPropertyOptional({
    example: 'Consumer electronics and computer accessories',
    maxLength: 255,
    nullable: true,
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;
}
