import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * An inventory API that cannot reach its database cannot serve a useful
 * request, so the check queries PostgreSQL rather than only reporting that the
 * process is alive. Docker uses this as the container HEALTHCHECK.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Service and database health' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok', database: 'up' } } })
  @ApiResponse({ status: 503, description: 'PostgreSQL is unreachable' })
  async check(): Promise<{ status: string; database: string }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
  }
}
