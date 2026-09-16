import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InteropRecord } from './interop.contract';
import { InteropService } from './interop.service';

/**
 * The half of the contract the other cloud consumes. Its own resource rather
 * than a route under `/v2/items`, so it never competes with `@Get(':id')` and
 * so the shared contract can evolve without touching the items API.
 */
@ApiTags('Interop v2')
@Controller({ path: 'interop', version: '2' })
export class InteropV2Controller {
  constructor(private readonly service: InteropService) {}

  @Get('random')
  @ApiOperation({
    summary: 'One random record, in the shape both clouds agreed on',
    description:
      'What the orchestrator calls when the other API needs a record from ' +
      'here. Returns an active item mapped to the shared contract.',
  })
  @ApiResponse({ status: 200, type: InteropRecord })
  @ApiResponse({ status: 404, description: 'There is nothing to return yet' })
  async random(): Promise<InteropRecord> {
    const record = await this.service.randomLocalRecord();
    if (!record) {
      throw new NotFoundException({
        code: 'NO_RECORDS',
        message: 'There are no active items to share',
      });
    }
    return record;
  }
}
