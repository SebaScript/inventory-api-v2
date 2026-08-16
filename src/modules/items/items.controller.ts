import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  QueryMethod,
} from '@nestjs/common';
import {
  ApiBody,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
} from '../../common/decorators/api-responses.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { InventorySummaryDto } from './dto/inventory-summary.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { SearchItemsDto } from './dto/search-items.dto';
import { ReplaceItemDto, UpdateItemDto } from './dto/update-item.dto';
import { Item } from './entities/item.entity';
import { ItemsService } from './items.service';

@ApiTags('Items')
@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an item',
    description:
      'A non-zero `quantity` is recorded as an opening IN movement in the same ' +
      'transaction, so stock is always explained by the ledger.',
  })
  @ApiResponse({ status: 201, description: 'Item created', type: Item })
  @ApiCommonErrors(404, 409)
  create(@Body() dto: CreateItemDto): Promise<Item> {
    return this.itemsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List items',
    description:
      'Paginated, filterable and sortable. For richer filtering (several ' +
      'groups at once, ranges, multi-field ordering) use `QUERY /items/search`.',
  })
  @ApiPaginatedResponse(Item, 'Paginated list of items')
  @ApiCommonErrors()
  findAll(@Query() query: QueryItemsDto): Promise<PaginatedResponseDto<Item>> {
    return this.itemsService.findAll(query);
  }

  // ---------------------------------------------------------------------------
  // Static paths MUST be declared before `:id`. Express matches routes in
  // declaration order, so `GET /items/low-stock` would otherwise be captured by
  // `GET /items/:id` and rejected by ParseIntPipe with a confusing 400.
  // ---------------------------------------------------------------------------

  @Get('low-stock')
  @ApiOperation({
    summary: 'List items at or below their minimum stock',
    description:
      'Ordered by urgency (largest shortfall first) and served by the partial ' +
      'index `idx_items_low_stock`.',
  })
  @ApiPaginatedResponse(Item, 'Paginated list of low-stock items')
  @ApiCommonErrors()
  findLowStock(@Query() query: PaginationQueryDto): Promise<PaginatedResponseDto<Item>> {
    return this.itemsService.findLowStock(query.page, query.pageSize);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Inventory summary',
    description:
      'Totals and a per-group breakdown, computed with SQL aggregates so the ' +
      'cost stays flat as the catalogue grows.',
  })
  @ApiResponse({ status: 200, description: 'Aggregate inventory view', type: InventorySummaryDto })
  @ApiCommonErrors()
  summary(): Promise<InventorySummaryDto> {
    return this.itemsService.summary();
  }

  /**
   * Advanced inventory search over the **HTTP QUERY** verb.
   *
   * QUERY (draft-ietf-httpbis-safe-method-w-body) is a safe, idempotent method
   * that carries a request body — exactly what this endpoint needs:
   *
   *  - The filter is a nested structure (arrays of group ids, two inclusive
   *    ranges, an ordered list of sort criteria). Encoding that into a query
   *    string means inventing an array/object encoding and running into URL
   *    length limits.
   *  - The operation only reads. POST would tell caches, proxies and readers
   *    that state changes, which is simply untrue.
   *
   * NestJS 11 supports the verb natively: `@QueryMethod` maps to
   * `RequestMethod.QUERY`, which the Express adapter registers through
   * `app.query()`. No custom routing or middleware is involved.
   *
   * OpenAPI 3.0 has a closed set of HTTP methods that does not include `query`,
   * so this operation cannot be rendered by Swagger UI. It is documented in the
   * Swagger page description and in the README instead, and `POST /items/search`
   * below exists purely so tooling that cannot emit QUERY can still reach it.
   */
  @QueryMethod('search')
  @ApiExcludeEndpoint()
  searchWithQueryVerb(@Body() dto: SearchItemsDto): Promise<PaginatedResponseDto<Item>> {
    return this.itemsService.search(dto);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advanced item search (interoperability alias for QUERY /items/search)',
    description:
      'The canonical verb for this endpoint is **QUERY**, which is safe and ' +
      'idempotent. This POST alias exists only because OpenAPI 3.0 and Swagger ' +
      'UI cannot express or emit the QUERY method. Identical body, identical ' +
      'response, identical handler — prefer QUERY when your client supports it.',
  })
  @ApiBody({ type: SearchItemsDto })
  @ApiPaginatedResponse(Item, 'Paginated search results')
  @ApiCommonErrors()
  searchWithPostAlias(@Body() dto: SearchItemsDto): Promise<PaginatedResponseDto<Item>> {
    return this.itemsService.search(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an item by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'The requested item', type: Item })
  @ApiCommonErrors(404)
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Item> {
    return this.itemsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Replace an item',
    description:
      'Full replacement of the client-owned fields. `quantity` is not one of ' +
      'them: stock belongs to the movements ledger and is preserved. Sending it ' +
      'returns 400.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Item replaced', type: Item })
  @ApiCommonErrors(404, 409)
  replace(@Param('id', ParseIntPipe) id: number, @Body() dto: ReplaceItemDto): Promise<Item> {
    return this.itemsService.replace(id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Partially update an item',
    description: 'Only the supplied fields change. `quantity` is not accepted here.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Item updated', type: Item })
  @ApiCommonErrors(404, 409)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto): Promise<Item> {
    return this.itemsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an item',
    description: 'The item’s movement history is deleted with it (cascade).',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 204, description: 'Item deleted' })
  @ApiCommonErrors(404)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.itemsService.remove(id);
  }
}
