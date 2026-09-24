import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExportResult, ExportsService } from './exports.service';

/** POST: every call creates a file in S3. Own resource, so it never competes with `@Get(':id')`. */
@ApiTags('Exports v2')
@Controller({ path: 'exports', version: '2' })
export class ExportsV2Controller {
  constructor(private readonly service: ExportsService) {}

  @Post('items')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Snapshot the inventory to object storage',
    description:
      'Writes a CSV of every item to S3 and returns a presigned download link ' +
      'that expires in 15 minutes. The bucket itself stays private.',
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        key: 'exports/items-2026-09-11T23-10-00.000Z-0f1c.csv',
        rows: 6,
        bytes: 612,
        url: 'https://bucket.s3.amazonaws.com/exports/...',
        expiresInSeconds: 900,
      },
    },
  })
  @ApiResponse({ status: 503, description: 'Object storage is not configured' })
  create(): Promise<ExportResult> {
    return this.service.exportItems();
  }
}
