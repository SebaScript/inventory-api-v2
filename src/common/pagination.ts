import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Hard ceiling, so a client can never ask for the whole table at once. */
export const MAX_LIMIT = 100;

/** Query parameters every list endpoint accepts. */
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

/** Envelope every list endpoint returns. */
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

/**
 * `numeric` columns come back from the pg driver as strings, because they can
 * hold values outside what a JS number represents exactly. Prices here are
 * bounded, so converting is safe and keeps the JSON free of quoted numbers.
 */
export const numericColumn = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
