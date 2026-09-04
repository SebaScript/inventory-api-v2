import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Paginated } from '../common/pagination';
import { Movement } from '../entities/movement.entity';
import { CreateMovementDto, FindMovementsDto } from './movement.dto';
import { MovementsService } from './movements.service';

/**
 * Every route of the resource, with no path and no version of its own. Each
 * version below mounts it, so a version only has to declare what it changes.
 */
export abstract class MovementsControllerBase {
  constructor(protected readonly service: MovementsService) {}

  @Post()
  @ApiOperation({
    summary: 'Record a stock movement',
    description:
      'Writes the ledger entry and the new stock in one transaction, with the ' +
      'item row locked so concurrent requests cannot oversell.',
  })
  @ApiResponse({ status: 201, type: Movement })
  @ApiResponse({ status: 409, description: 'Insufficient stock — nothing was written' })
  create(@Body() dto: CreateMovementDto): Promise<Movement> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List movements (filter by itemId, type)' })
  findAll(@Query() query: FindMovementsDto): Promise<Paginated<Movement>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one movement' })
  @ApiResponse({ status: 200, type: Movement })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Movement> {
    return this.service.findOne(id);
  }
}

@ApiTags('Movements')
@Controller('movements')
export class MovementsController extends MovementsControllerBase {
  // Declared on purpose: without it TypeScript emits no `design:paramtypes`
  // for this class and Nest injects `undefined` instead of failing to start.
  constructor(service: MovementsService) {
    super(service);
  }
}
