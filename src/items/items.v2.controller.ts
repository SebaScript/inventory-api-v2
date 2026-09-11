import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { CacheService, ITEMS_NAMESPACE } from '../cache/cache.service';
import { Paginated } from '../common/pagination';
import { Item } from '../entities/item.entity';
import { FindItemsDto, StatusFilter } from './item.dto';
import { ItemsControllerBase } from './items.controller';
import { ItemsService } from './items.service';

const LIST_TTL_SECONDS = 30;

/**
 * Two queries that return the same rows must produce the same key, or the hit
 * rate halves for no reason:
 *   - no status and `status=ACTIVE` are the same query, because the service
 *     defaults to ACTIVE;
 *   - the search is matched with ILIKE, so its case does not affect the result.
 *
 * Hashed because `search` has no maximum length, so the raw key could be
 * megabytes long and free text could collide with another query by injecting
 * the separator.
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

/**
 * `/v2/items`: the same routes and the same service as v1, with the listing
 * served from the distributed cache.
 */
@ApiTags('Items v2')
@Controller({ path: 'items', version: '2' })
export class ItemsV2Controller extends ItemsControllerBase {
  // Declared on purpose: without it TypeScript emits no `design:paramtypes`
  // for this class and Nest injects `undefined` instead of failing to start.
  constructor(
    service: ItemsService,
    private readonly cache: CacheService,
  ) {
    super(service);
  }

  // `@Get()` and `@Query()` have to be repeated. Route metadata is read off the
  // function object, not the class, so an override without them shadows the
  // decorated base method and the route disappears with no error at all.
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
}
