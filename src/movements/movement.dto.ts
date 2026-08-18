import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../common/pagination';
import { MovementType } from '../entities/movement.entity';

export class CreateMovementDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  itemId: number;

  @ApiProperty({ enum: MovementType, example: MovementType.IN })
  @IsEnum(MovementType, { message: 'type must be IN or OUT' })
  type: MovementType;

  @ApiProperty({
    example: 25,
    description: 'Always positive — the direction comes from `type`, never from a sign',
  })
  @IsInt()
  @Min(1, { message: 'quantity must be greater than 0' })
  quantity: number;

  @ApiPropertyOptional({ example: 'Supplier delivery #4471' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class FindMovementsDto extends PaginationDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itemId?: number;

  @ApiPropertyOptional({ enum: MovementType })
  @IsOptional()
  @IsEnum(MovementType)
  type?: MovementType;
}
