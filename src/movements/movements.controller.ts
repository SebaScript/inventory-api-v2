import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Paginated } from '../common/pagination';
import { Movement } from '../entities/movement.entity';
import { CreateMovementDto, FindMovementsDto } from './movement.dto';
import { MovementsService } from './movements.service';

/**
 * Append-only: no PUT, PATCH or DELETE. Rewriting a ledger entry would break
 * the guarantee that stock equals the sum of its movements.
 */
@ApiTags('Movements')
@Controller('movements')
export class MovementsController {
  constructor(private readonly service: MovementsService) {}

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
