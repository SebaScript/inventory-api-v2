import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PaginationDto } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateGroupDto {
  @ApiPropertyOptional({ example: 'Electronics', minLength: 2, maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({ example: 'Consumer electronics' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

export class FindGroupsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'elec', description: 'Case-insensitive match on name' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
