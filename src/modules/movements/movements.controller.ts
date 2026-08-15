import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
} from '../../common/decorators/api-responses.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { QueryMovementsDto } from './dto/query-movements.dto';
import { Movement } from './entities/movement.entity';
import { MovementsService } from './movements.service';

/**
 * Movements are append-only: there is no PUT, PATCH or DELETE.
 *
 * Rewriting a ledger entry would break the guarantee that an item's stock
 * equals the sum of its movements. Mistakes are corrected by recording a
 * compensating movement, exactly as a real inventory system does.
 */
@ApiTags('Movements')
@Controller('movements')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Record a stock movement',
    description:
      'Creates the ledger entry and updates the item stock in a single ' +
      'transaction, with the item row locked (`SELECT ... FOR UPDATE`) so two ' +
      'concurrent requests cannot oversell. An OUT that would take stock below ' +
      'zero is rejected with 409 and nothing is persisted.',
  })
  @ApiResponse({ status: 201, description: 'Movement recorded', type: Movement })
  @ApiResponse({
    status: 409,
    description: 'Insufficient stock: the movement was not created and the item was not modified',
  })
  @ApiCommonErrors(404, 409)
  create(@Body() dto: CreateMovementDto): Promise<Movement> {
    return this.movementsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List movements',
    description: 'Paginated, filterable by item, direction and date range.',
  })
  @ApiPaginatedResponse(Movement, 'Paginated list of movements')
  @ApiCommonErrors()
  findAll(@Query() query: QueryMovementsDto): Promise<PaginatedResponseDto<Movement>> {
    return this.movementsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a movement by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'The requested movement', type: Movement })
  @ApiCommonErrors(404)
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Movement> {
    return this.movementsService.findOne(id);
  }
}
