import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Service and database health' })
  @ApiResponse({
    status: 200,
    schema: { example: { status: 'ok', database: 'up', revision: 'a1b2c3d' } },
  })
  @ApiResponse({ status: 503, description: 'PostgreSQL is unreachable' })
  async check(): Promise<{ status: string; database: string; revision: string }> {
    try {
      await this.dataSource.query('SELECT 1');
      // `revision` is stamped into the image at build time, so the deploy job
      // can confirm the host is serving the commit it just published.
      return { status: 'ok', database: 'up', revision: process.env.GIT_SHA ?? 'dev' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
