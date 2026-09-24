import { Controller, Get, Headers, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { CacheService, ITEMS_NAMESPACE } from '../cache/cache.service';
import { CORRELATION_HEADER } from '../common/correlation';
import { Paginated } from '../common/pagination';
import { Item } from '../entities/item.entity';
import { PartnerLookup } from '../interop/interop.contract';
import { InteropService } from '../interop/interop.service';
import { FindItemsDto, StatusFilter } from './item.dto';
import { ItemsControllerBase } from './items.controller';
import { ItemsService } from './items.service';

const LIST_TTL_SECONDS = 30;

export class ItemWithPartner extends Item {
  @ApiProperty({ type: PartnerLookup })
  partner: PartnerLookup;
}

/**
 * Same rows, same key: no status equals ACTIVE, and search is case-insensitive.
 * Hashed because `search` has no length limit.
 */
export function itemsListKey(query: FindItemsDto): string {
  const canonical = JSON.stringify([
    query.status ?? StatusFilter.ACTIVE,
    query.page,
    query.limit,
    query.groupId ?? null,
    query.lowStock === true,
    query.search?.toLowerCase() ?? null,
  ]);

  return `list:${createHash('sha1').update(canonical).digest('base64url')}`;
}

/** `/v2/items`: the v1 routes, plus a cached listing and the other cloud's record. */
@ApiTags('Items v2')
@Controller({ path: 'items', version: '2' })
export class ItemsV2Controller extends ItemsControllerBase {
  // Required: without it Nest injects `undefined` instead of failing.
  constructor(
    service: ItemsService,
    private readonly cache: CacheService,
    private readonly interop: InteropService,
  ) {
    super(service);
  }

  // Overrides must repeat the route decorators, or the route silently disappears.
  @Get()
  @ApiOperation({ summary: 'List items, served from a short-lived distributed cache' })
  override async findAll(@Query() query: FindItemsDto): Promise<Paginated<Item>> {
    const key = itemsListKey(query);
    const { value, epoch } = await this.cache.read<Paginated<Item>>(ITEMS_NAMESPACE, key);
    if (value) return value;

    const page = await this.service.findAll(query);
    await this.cache.write(ITEMS_NAMESPACE, key, epoch, page, LIST_TTL_SECONDS);
    return page;
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one item, together with a record from the other cloud',
    description:
      'The item is read locally. `partner` is fetched through the orchestrator ' +
      'and is never allowed to hold up or break this response: if the other ' +
      'cloud does not answer in time, it comes back as `unavailable`.',
  })
  @ApiResponse({ status: 200, type: ItemWithPartner })
  override async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Headers(CORRELATION_HEADER) correlationId?: string,
  ): Promise<ItemWithPartner> {
    // Local first: an unknown id 404s without calling the other cloud.
    const item = await this.service.findOne(id);
    const partner = await this.interop.fetchPartnerRecord(correlationId);

    return Object.assign(item, { partner });
  }
}
