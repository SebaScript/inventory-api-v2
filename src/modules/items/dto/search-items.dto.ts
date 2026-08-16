import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SortOrder,
} from '../../../common/dto/pagination-query.dto';
import { ItemSortField } from './query-items.dto';

/** Inclusive numeric range. Reused for both price and stock filtering. */
export class RangeFilterDto {
  @ApiPropertyOptional({ example: 5, description: 'Lower bound, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  min?: number;

  @ApiPropertyOptional({ example: 200, description: 'Upper bound, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  max?: number;
}

/** One level of an explicit multi-field ordering. */
export class SortCriterionDto {
  @ApiPropertyOptional({ enum: ItemSortField, example: ItemSortField.QUANTITY })
  @IsEnum(ItemSortField, {
    message: `sort.field must be one of: ${Object.values(ItemSortField).join(', ')}`,
  })
  field: ItemSortField;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.ASC })
  @IsOptional()
  @IsEnum(SortOrder)
  order: SortOrder = SortOrder.ASC;
}

/**
 * Request body of `QUERY /items/search`.
 *
 * This shape is the reason the endpoint uses the HTTP QUERY verb rather than
 * GET or POST:
 *
 *  - It is a **nested structure** — arrays of group ids, two inclusive ranges
 *    and an ordered list of sort criteria. Expressing that in a query string
 *    means inventing an encoding for arrays and objects, and it runs into URL
 *    length limits as soon as a caller filters on many groups.
 *  - It is **safe and idempotent**: it reads, it never modifies. POST would
 *    misrepresent that to caches, proxies and to anyone reading the API.
 *
 * HTTP QUERY (draft-ietf-httpbis-safe-method-w-body) is precisely the verb for
 * "a read with a request body", so it is the correct one here.
 */
export class SearchItemsDto {
  @ApiPropertyOptional({
    example: 'usb',
    maxLength: 120,
    description:
      'Free-text search across name, SKU and description. Served by the pg_trgm ' +
      'GIN indexes rather than a sequential scan.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  text?: string;

  @ApiPropertyOptional({
    example: [1, 3],
    type: [Number],
    description: 'Restrict to these groups. Up to 100 ids.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  groupIds?: number[];

  @ApiPropertyOptional({ type: RangeFilterDto, description: 'Inclusive unit price range' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RangeFilterDto)
  price?: RangeFilterDto;

  @ApiPropertyOptional({ type: RangeFilterDto, description: 'Inclusive stock quantity range' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RangeFilterDto)
  stock?: RangeFilterDto;

  @ApiPropertyOptional({
    example: false,
    description: 'Restrict to items at or below their configured minimum stock',
  })
  @IsOptional()
  @IsBoolean()
  lowStockOnly?: boolean;

  @ApiPropertyOptional({
    type: [SortCriterionDto],
    description: 'Ordered list of sort criteria, applied left to right',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => SortCriterionDto)
  sort?: SortCriterionDto[];

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }
}
