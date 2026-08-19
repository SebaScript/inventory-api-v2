import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const MAX_LIMIT = 100;

export class PaginationDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit = 20;
}

export class Paginated<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({
    example: { page: 1, limit: 20, total: 42, pages: 3 },
  })
  meta: { page: number; limit: number; total: number; pages: number };

  constructor(data: T[], total: number, page: number, limit: number) {
    this.data = data;
    this.meta = { page, limit, total, pages: Math.ceil(total / limit) };
  }
}

export const numericColumn = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
