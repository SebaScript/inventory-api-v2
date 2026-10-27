import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags, OmitType } from '@nestjs/swagger';
import { Item } from '../entities/item.entity';
import { CreateItemV3Dto, UpdateItemV3Dto } from './item.dto';
import { ItemsControllerBase } from './items.controller';
import { ItemsV3Service } from './items.service';

export class ItemV3 extends OmitType(Item, ['location'] as const) {
  @ApiProperty({ example: 'A-03-2', nullable: true, description: 'Bin in the warehouse' })
  location: string | null;
}

/** `/v3/items`: every item carries its bin location, which v1 and v2 never see. */
@ApiTags('Items v3')
@Controller({ path: 'items', version: '3' })
export class ItemsV3Controller extends ItemsControllerBase {
  // Required: without it Nest injects `undefined` instead of failing.
  constructor(service: ItemsV3Service) {
    super(service);
  }

  // Overrides must repeat the route decorators, or the route silently disappears.
  @Post()
  @ApiOperation({ summary: 'Create an item, with its bin location if known' })
  @ApiResponse({ status: 201, type: ItemV3 })
  override create(@Body() dto: CreateItemV3Dto): Promise<Item> {
    return this.service.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one item, with its bin location' })
  @ApiResponse({ status: 200, type: ItemV3 })
  override findOne(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an item, its bin location included. quantity is rejected' })
  override update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateItemV3Dto,
  ): Promise<Item> {
    return this.service.update(id, dto);
  }
}
