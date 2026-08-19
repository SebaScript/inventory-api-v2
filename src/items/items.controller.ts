import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  QueryMethod,
} from '@nestjs/common';
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Paginated } from '../common/pagination';
import { Item } from '../entities/item.entity';
import { CreateItemDto, FindItemsDto, SearchItemsDto, UpdateItemDto } from './item.dto';
import { ItemsService } from './items.service';

@ApiTags('Items')
@Controller('items')
export class ItemsController {
  constructor(private readonly service: ItemsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an item' })
  @ApiResponse({ status: 201, type: Item })
  create(@Body() dto: CreateItemDto): Promise<Item> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List items (filter by search, groupId, lowStock)' })
  findAll(@Query() query: FindItemsDto): Promise<Paginated<Item>> {
    return this.service.findAll(query);
  }

  // `search` must come before `:id` — Express matches in declaration order, so
  // otherwise ParseIntPipe would reject "search" with a confusing 400.

  /**
   * Advanced search over the HTTP **QUERY** verb: safe and idempotent like GET,
   * but with a request body. NestJS 11 supports it natively via @QueryMethod.
   *
   * Hidden from Swagger because OpenAPI 3.0 has a closed list of methods that
   * does not include `query`; the POST alias below exists for that reason.
   */
  @QueryMethod('search')
  @ApiExcludeEndpoint()
  search(@Body() dto: SearchItemsDto): Promise<Paginated<Item>> {
    return this.service.search(dto);
  }

  @Post('search')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Advanced search — alias of QUERY /items/search',
    description:
      'The canonical verb is QUERY. This POST alias exists only because ' +
      'Swagger UI cannot send the QUERY method. Same body, same response.',
  })
  @ApiBody({ type: SearchItemsDto })
  searchAlias(@Body() dto: SearchItemsDto): Promise<Paginated<Item>> {
    return this.service.search(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one item' })
  @ApiResponse({ status: 200, type: Item })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an item: only the fields sent change. quantity is rejected' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto): Promise<Item> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Discontinue an item',
    description:
      'Does not erase anything: the item is marked DISCONTINUED so its movement ' +
      'history stays auditable. It disappears from listings and accepts no new ' +
      'movements. Reactivate with PATCH { "status": "ACTIVE" }.',
  })
  discontinue(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.discontinue(id);
  }
}
