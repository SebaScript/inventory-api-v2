import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { registry } from './registry';

/**
 * The scrape endpoint an external Prometheus, and through it Grafana, reads.
 *
 * Version neutral like /health: it describes the process, not the API surface.
 * Excluded from the published documentation because it is an operational
 * endpoint and its body is not JSON.
 */
@Controller('metrics')
export class MetricsController {
  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', registry.contentType)
  scrape(): Promise<string> {
    return registry.metrics();
  }
}
