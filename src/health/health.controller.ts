import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
  ) {}

  /**
   * Liveness *and* readiness in one endpoint.
   *
   * An inventory API that cannot reach PostgreSQL cannot serve a single useful
   * request, so reporting "ok" while the database is down would be actively
   * misleading — to a load balancer, to Docker's healthcheck, and to whoever is
   * on call. The database ping is therefore part of the check, and a failure
   * produces 503.
   */
  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Service health',
    description:
      'Returns 200 when the API is up and PostgreSQL responds to a ping, ' +
      '503 otherwise. Used as the container HEALTHCHECK.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      example: {
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service is degraded: PostgreSQL is unreachable',
    schema: {
      example: {
        status: 'error',
        info: {},
        error: { database: { status: 'down', message: 'timeout of 3000ms exceeded' } },
        details: { database: { status: 'down', message: 'timeout of 3000ms exceeded' } },
      },
    },
  })
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.pingCheck('database', { timeout: 3000 })]);
  }
}
