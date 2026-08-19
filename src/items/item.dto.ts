import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination';
import { ItemStatus } from '../entities/item.entity';

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

  @ApiPropertyOptional({ example: 'ELEC-USBC-2M' })
  @Transform(upper)
  @IsString()
  @Length(2, 40)
  sku: string;

  @ApiPropertyOptional({ example: 0, description: 'Opening stock, recorded as an IN movement' })
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

/** `quantity` is excluded: stock belongs to the movements ledger. */
export class ReplaceItemDto extends OmitType(CreateItemDto, ['quantity'] as const) {}

export class UpdateItemDto extends PartialType(ReplaceItemDto) {
  /** Lets a discontinued item be brought back into service. */
  @ApiPropertyOptional({ enum: ItemStatus })
  @IsOptional()
  @IsEnum(ItemStatus)
  status?: ItemStatus;
}

/** `ALL` includes discontinued items; listings default to active only. */
export enum StatusFilter {
  ACTIVE = 'ACTIVE',
  DISCONTINUED = 'DISCONTINUED',
  ALL = 'ALL',
}

export class FindItemsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'usb', description: 'Matches name or SKU' })
  @Transform(trim)
  @IsOptional()
  @IsString()
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

  @ApiPropertyOptional({ enum: StatusFilter, default: StatusFilter.ACTIVE })
  @IsOptional()
  @IsEnum(StatusFilter)
  status?: StatusFilter;
}

export class SearchItemsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'usb' })
  @Transform(trim)
  @IsOptional()
  @IsString()
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
  maxPrice?: number;
}
