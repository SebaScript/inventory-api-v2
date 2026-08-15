import { ApiProperty } from '@nestjs/swagger';

export class PaginationMeta {
  @ApiProperty({ example: 1, description: 'Current 1-based page number' })
  page: number;

  @ApiProperty({ example: 20, description: 'Records requested per page' })
  pageSize: number;

  @ApiProperty({ example: 137, description: 'Total records matching the query' })
  total: number;

  @ApiProperty({ example: 7, description: 'Total number of pages available' })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}

/**
 * Envelope returned by every list endpoint.
 *
 * A consistent shape means clients write pagination handling once, and the
 * `meta` block gives them everything needed to build navigation without a
 * second round trip.
 */
export class PaginatedResponseDto<T> {
  @ApiProperty({ isArray: true })
  data: T[];

  @ApiProperty({ type: PaginationMeta })
  meta: PaginationMeta;

  constructor(data: T[], total: number, page: number, pageSize: number) {
    const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

    this.data = data;
    this.meta = {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && total > 0,
    };
  }
}
