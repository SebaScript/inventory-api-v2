import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** SKUs are stored uppercase so `abc-1` and `ABC-1` cannot both exist. */
const normaliseSku = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/** Guards against 12.999 sneaking past a `numeric(12,2)` column. */
const MAX_UNIT_PRICE = 9_999_999_999.99;

export class CreateItemDto {
  @ApiProperty({ example: 1, description: 'Identifier of an existing group' })
  @IsInt({ message: 'groupId must be an integer' })
  @Min(1)
  groupId: number;

  @ApiProperty({ example: 'USB-C Cable 2m', minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiPropertyOptional({ example: 'Braided USB-C to USB-C cable', maxLength: 500, nullable: true })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty({
    example: 'ELEC-USBC-2M',
    minLength: 2,
    maxLength: 40,
    description: 'Globally unique. Normalised to uppercase before storage.',
  })
  @Transform(normaliseSku)
  @IsString()
  @Length(2, 40)
  sku: string;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description:
      'Opening stock. When greater than zero an initial IN movement is recorded ' +
      'in the same transaction, so the ledger always explains the current stock. ' +
      'After creation, stock can only be changed through movements.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({
    example: 10,
    minimum: 0,
    default: 0,
    description: 'Stock level at or below which the item is reported as low stock',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimumStock?: number;

  @ApiPropertyOptional({ example: 12.5, minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'unitPrice supports at most 2 decimal places' })
  @Min(0)
  @Max(MAX_UNIT_PRICE)
  unitPrice?: number;
}
