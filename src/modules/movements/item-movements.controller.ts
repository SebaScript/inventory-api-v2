import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
} from '../../common/decorators/api-responses.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryMovementsDto } from './dto/query-movements.dto';
import { Movement } from './entities/movement.entity';
import { MovementsService } from './movements.service';

/**
 * Nested route exposing the Item -> Movement relationship, kept in the
 * movements module so `ItemsModule` never has to depend on `MovementsModule`.
 */
@ApiTags('Movements')
@Controller('items/:itemId/movements')
export class ItemMovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Get()
  @ApiOperation({
    summary: 'Stock history of an item',
    description:
      'The full ledger for one item. Each entry carries `resultingStock`, so ' +
      'stock at any past point can be read directly without replaying the list.',
  })
  @ApiParam({ name: 'itemId', type: Number, example: 1 })
  @ApiPaginatedResponse(Movement, 'Paginated ledger for the item')
  @ApiCommonErrors(404)
  findByItem(
    @Param('itemId', ParseIntPipe) itemId: number,
    @Query() query: QueryMovementsDto,
  ): Promise<PaginatedResponseDto<Movement>> {
    return this.movementsService.findByItem(itemId, query);
  }
}
