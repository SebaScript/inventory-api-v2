import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { MovementType } from '../entities/movement.entity';

export class CreateMovementDto {
  @ApiProperty({ example: 1, description: 'Identifier of an existing item' })
  @IsInt({ message: 'itemId must be an integer' })
  @Min(1)
  itemId: number;

  @ApiProperty({
    enum: MovementType,
    example: MovementType.IN,
    description: 'IN increases stock, OUT decreases it. No other value is accepted.',
  })
  @IsEnum(MovementType, {
    message: `type must be one of: ${Object.values(MovementType).join(', ')}`,
  })
  type: MovementType;

  @ApiProperty({
    example: 25,
    minimum: 1,
    description:
      'Units moved. Always a positive number — the direction is carried by `type`, ' +
      'never by the sign of this field.',
  })
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be greater than 0' })
  quantity: number;

  @ApiPropertyOptional({
    example: 'Supplier delivery #4471',
    maxLength: 255,
    description: 'Free-text justification stored with the ledger entry',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string | null;
}
