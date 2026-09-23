import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CORRELATION_HEADER } from '../common/correlation';
import { FlowMessage, InteropRecord } from './interop.contract';
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

  @Post('messages')
  @HttpCode(201)
  @ApiOperation({
    summary: 'One step of the cross-cloud flow',
    description:
      'The orchestrator posts the message it is carrying. This API appends one ' +
      'of its items to `entities`, stores the accumulated JSON in object storage ' +
      'and appends a presigned link to `attachments`. Everything else in the ' +
      'message comes back as it arrived.',
  })
  @ApiBody({ schema: { type: 'object', example: { correlationId: '3f2c9a1e', entities: [] } } })
  @ApiResponse({ status: 201, type: FlowMessage })
  @ApiResponse({ status: 400, description: 'The body is not a JSON object' })
  @ApiResponse({ status: 404, description: 'There is no active item to add' })
  async step(
    @Body() message: unknown,
    @Headers(CORRELATION_HEADER) correlationId?: string,
  ): Promise<FlowMessage> {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      throw new BadRequestException({
        code: 'INVALID_MESSAGE',
        message: 'The flow message must be a JSON object',
      });
    }

    const result = await this.service.appendToMessage(
      message as Record<string, unknown>,
      correlationId,
    );
    if (!result) {
      throw new NotFoundException({
        code: 'NO_RECORDS',
        message: 'There are no active items to add to the message',
      });
    }
    return result;
  }

  @Delete('cache')
  @ApiOperation({
    summary: 'Drop the cached records from the other cloud',
    description:
      'The TTL bounds how stale a partner record can be; this forces the next ' +
      'read to go back across the clouds straight away, which is what makes a ' +
      'change made on the other side visible immediately.',
  })
  @ApiResponse({ status: 200, description: '`invalidated` is false when no cache is configured' })
  async invalidate(): Promise<{ invalidated: boolean }> {
    return this.service.invalidatePartnerCache();
  }
}
