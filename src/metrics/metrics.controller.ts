import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { registry } from './registry';

/** Prometheus scrape endpoint. Version neutral and out of Swagger: it describes the process. */
@Controller('metrics')
export class MetricsController {
  @Get()
  @ApiExcludeEndpoint()
  @Header('Content-Type', registry.contentType)
  scrape(): Promise<string> {
    return registry.metrics();
  }
}
