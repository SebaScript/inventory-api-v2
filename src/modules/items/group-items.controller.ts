import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
} from '../../common/decorators/api-responses.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryItemsDto } from './dto/query-items.dto';
import { Item } from './entities/item.entity';
import { ItemsService } from './items.service';

/**
 * Nested route exposing the Group -> Item relationship.
 *
 * It lives in the items module rather than the groups module so that
 * `GroupsModule` never needs to depend on `ItemsModule`: the dependency arrow
 * points one way only, and there is no circular import to work around.
 */
@ApiTags('Items')
@Controller('groups/:groupId/items')
export class GroupItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the items of a group',
    description:
      'Same filtering and sorting as `GET /items`, scoped to one group. ' +
      'Returns 404 when the group does not exist, rather than an empty page.',
  })
  @ApiParam({ name: 'groupId', type: Number, example: 1 })
  @ApiPaginatedResponse(Item, 'Paginated list of the group items')
  @ApiCommonErrors(404)
  findByGroup(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query() query: QueryItemsDto,
  ): Promise<PaginatedResponseDto<Item>> {
    return this.itemsService.findByGroup(groupId, query);
  }
}
