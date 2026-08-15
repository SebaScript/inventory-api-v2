import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

/** Hard ceiling on page size, so a client can never ask for the whole table. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Pagination and ordering parameters shared by every list endpoint.
 *
 * Resource-specific DTOs extend this and add their own `sortBy` enum, which is
 * what makes ordering safe: the column name can only ever be one of a fixed set
 * of values, so it can be interpolated into `ORDER BY` without risk of
 * injection.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1, description: '1-based page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: `Records per page. Capped at ${MAX_PAGE_SIZE}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize must be an integer' })
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @IsOptional()
  @IsEnum(SortOrder, {
    message: `sortOrder must be one of: ${Object.values(SortOrder).join(', ')}`,
  })
  sortOrder: SortOrder = SortOrder.ASC;

  /** Offset derived from the validated page/pageSize pair. */
  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}
