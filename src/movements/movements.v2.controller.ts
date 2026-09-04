import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MovementsControllerBase } from './movements.controller';
import { MovementsService } from './movements.service';

/** `/v2/movements`: same routes and same service as v1, ready to diverge. */
@ApiTags('Movements v2')
@Controller({ path: 'movements', version: '2' })
export class MovementsV2Controller extends MovementsControllerBase {
  constructor(service: MovementsService) {
    super(service);
  }
}
