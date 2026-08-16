import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MovementType } from '../entities/movement.entity';

/** Whitelist of orderable columns; see `PaginationQueryDto` for the rationale. */
export enum MovementSortField {
  ID = 'id',
  QUANTITY = 'quantity',
  CREATED_AT = 'createdAt',
}

export class QueryMovementsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Restrict to a single item' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  itemId?: number;

  @ApiPropertyOptional({ enum: MovementType, description: 'Restrict to a movement direction' })
  @IsOptional()
  @IsEnum(MovementType)
  type?: MovementType;

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Only movements created at or after this ISO-8601 instant',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from must be a valid ISO-8601 date' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31T23:59:59.999Z',
    description: 'Only movements created at or before this ISO-8601 instant',
  })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to must be a valid ISO-8601 date' })
  to?: string;

  @ApiPropertyOptional({ enum: MovementSortField, default: MovementSortField.CREATED_AT })
  @IsOptional()
  @IsEnum(MovementSortField, {
    message: `sortBy must be one of: ${Object.values(MovementSortField).join(', ')}`,
  })
  sortBy: MovementSortField = MovementSortField.CREATED_AT;
}
