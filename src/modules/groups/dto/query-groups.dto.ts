import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Whitelist of orderable columns.
 *
 * Restricting `sortBy` to an enum is what makes it safe to place the value in
 * an `ORDER BY` clause: no client-supplied string ever reaches the SQL.
 */
export enum GroupSortField {
  ID = 'id',
  NAME = 'name',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

export class QueryGroupsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'elect',
    maxLength: 80,
    description: 'Case-insensitive partial match against name and description',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  search?: string;

  @ApiPropertyOptional({ enum: GroupSortField, default: GroupSortField.ID })
  @IsOptional()
  @IsEnum(GroupSortField, {
    message: `sortBy must be one of: ${Object.values(GroupSortField).join(', ')}`,
  })
  sortBy: GroupSortField = GroupSortField.ID;
}
