import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateItemDto {
  @ApiPropertyOptional({ example: 1 })
  @IsInt()
  @Min(1)
  groupId: number;

  @ApiPropertyOptional({ example: 'USB-C Cable' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ example: 'Braided 2m cable' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ example: 'ELEC-USBC-2M', description: 'Normalised to uppercase' })
  @Transform(upper)
  @IsString()
  @Length(2, 40)
  sku: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Opening stock. Recorded as an IN movement so the ledger explains it.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice?: number;
}

/**
 * `quantity` is excluded on purpose: stock belongs to the movements ledger.
 * Sending it returns 400 and points the caller at POST /movements.
 */
export class ReplaceItemDto extends OmitType(CreateItemDto, ['quantity'] as const) {}
export class UpdateItemDto extends PartialType(ReplaceItemDto) {}

export class FindItemsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'usb', description: 'Matches name or SKU' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number;

  @ApiPropertyOptional({ example: true, description: 'Only items at or below their minimum' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  lowStock?: boolean;
}

/**
 * Body of `QUERY /items/search`.
 *
 * This nested shape is exactly why the endpoint uses the QUERY verb: a list of
 * group ids plus two ranges does not fit a query string without inventing an
 * encoding for arrays, and it hits URL length limits. QUERY is safe and
 * idempotent like GET but carries a body, so it is the correct method.
 */
export class SearchItemsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'usb' })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  text?: string;

  @ApiPropertyOptional({ example: [1, 3], type: [Number] })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  groupIds?: number[];

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  maxPrice?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  lowStockOnly?: boolean;
}
