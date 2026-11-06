import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Item } from '../entities/item.entity';
import { ItemsControllerBase } from './items.controller';
import { ItemsV3Service } from './items.service';

export class ItemV3 extends Item {
  @ApiProperty({
    example: 1062.5,
    description: 'What the stock is worth: quantity × unitPrice. Computed, never stored',
  })
  stockValue: number;
}

/** `/v3/items`: the same routes, and every item says what its stock is worth. */
@ApiTags('Items v3')
@Controller({ path: 'items', version: '3' })
export class ItemsV3Controller extends ItemsControllerBase {
  // Required: without it Nest injects `undefined` instead of failing.
  constructor(service: ItemsV3Service) {
    super(service);
  }

  // Overridden only to document the new field: overrides must repeat the route decorators.
  @Get(':id')
  @ApiOperation({ summary: 'Get one item, with what its stock is worth' })
  @ApiResponse({ status: 200, type: ItemV3 })
  override findOne(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.service.findOne(id);
  }
}
