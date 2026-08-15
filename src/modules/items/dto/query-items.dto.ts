import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Whitelist of orderable columns; see `PaginationQueryDto` for the rationale. */
export enum ItemSortField {
  ID = 'id',
  NAME = 'name',
  SKU = 'sku',
  QUANTITY = 'quantity',
  UNIT_PRICE = 'unitPrice',
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}

/** Query strings carry everything as text, so `"false"` must not become `true`. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class QueryItemsDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'usb',
    maxLength: 120,
    description: 'Case-insensitive partial match against name, SKU and description',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Restrict results to a single group' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  groupId?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0, description: 'Minimum unit price, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 200, minimum: 0, description: 'Maximum unit price, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'When true, only items whose quantity is at or below their minimum stock',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({ enum: ItemSortField, default: ItemSortField.ID })
  @IsOptional()
  @IsEnum(ItemSortField, {
    message: `sortBy must be one of: ${Object.values(ItemSortField).join(', ')}`,
  })
  sortBy: ItemSortField = ItemSortField.ID;
}
