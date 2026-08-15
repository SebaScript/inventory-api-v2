import { ApiProperty } from '@nestjs/swagger';

export class GroupSummaryDto {
  @ApiProperty({ example: 1 })
  groupId: number;

  @ApiProperty({ example: 'Electronics' })
  groupName: string;

  @ApiProperty({ example: 4, description: 'Distinct items in this group' })
  itemCount: number;

  @ApiProperty({ example: 210, description: 'Sum of stock across the group' })
  totalUnits: number;

  @ApiProperty({ example: 4500.75, description: 'Sum of quantity x unitPrice' })
  totalValue: number;

  @ApiProperty({ example: 1, description: 'Items at or below their minimum stock' })
  lowStockCount: number;
}

/**
 * Aggregate view of the whole inventory.
 *
 * Computed with SQL aggregates rather than by loading every row, so the cost
 * stays flat as the catalogue grows.
 */
export class InventorySummaryDto {
  @ApiProperty({ example: 3 })
  totalGroups: number;

  @ApiProperty({ example: 10 })
  totalItems: number;

  @ApiProperty({ example: 512, description: 'Total units held across all items' })
  totalUnits: number;

  @ApiProperty({ example: 12345.67, description: 'Total inventory value at unit prices' })
  totalValue: number;

  @ApiProperty({ example: 2, description: 'Items at or below their minimum stock' })
  lowStockCount: number;

  @ApiProperty({ example: 1, description: 'Items with zero stock' })
  outOfStockCount: number;

  @ApiProperty({ type: [GroupSummaryDto], description: 'Per-group breakdown' })
  byGroup: GroupSummaryDto[];
}
