import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger model for the single error shape produced by `GlobalExceptionFilter`.
 *
 * Documented as a real schema so the API reference matches what clients
 * actually receive, down to the machine-readable `code`.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Conflict', description: 'HTTP reason phrase' })
  error: string;

  @ApiProperty({
    example: 'INSUFFICIENT_STOCK',
    description: 'Stable machine-readable code. Branch on this, not on `message`.',
  })
  code: string;

  @ApiProperty({ example: 'Insufficient stock for item 4: 3 unit(s) available, 10 requested' })
  message: string;

  @ApiPropertyOptional({
    example: { itemId: 4, available: 3, requested: 10 },
    description: 'Machine-readable context. For validation failures, holds `validationErrors`.',
  })
  details?: Record<string, unknown>;

  @ApiProperty({ example: '/movements' })
  path: string;

  @ApiProperty({ example: 'POST' })
  method: string;

  @ApiProperty({ example: '2026-08-16T10:00:00.000Z' })
  timestamp: string;

  @ApiProperty({
    example: '6f1e2c1a-3b0d-4c9e-9a1f-2d4e5f6a7b8c',
    description: 'Correlates this response with the server-side log entry.',
  })
  requestId: string;
}
