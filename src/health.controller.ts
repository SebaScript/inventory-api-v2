import {
  BeforeApplicationShutdown,
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** Time to keep serving after being taken out of rotation, before the socket closes. */
const DRAIN_MS = 5_000;

@ApiTags('Health')
@Controller('health')
export class HealthController implements BeforeApplicationShutdown {
  private shuttingDown = false;

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

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe: is the process itself alive',
    description:
      'Answers from memory and never touches the database on purpose. Pointing ' +
      'a liveness probe at the database means a brief database outage restarts ' +
      'every replica, turning a recoverable blip into a full outage.',
  })
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe: can this instance serve traffic',
    description:
      'Checks the database, and starts failing as soon as the process is asked ' +
      'to shut down so the load balancer stops sending new requests first.',
  })
  @ApiResponse({ status: 503, description: 'Draining, or PostgreSQL is unreachable' })
  async ready(): Promise<{ status: string; database: string }> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException({ status: 'draining', database: 'unknown' });
    }
    return this.check();
  }

  /**
   * Runs before the HTTP server closes. Kubernetes removes the pod from the
   * load balancer and sends SIGTERM at the same time, so without this pause
   * requests already in flight hit a closed socket during every rollout.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    // No signal means a programmatic close, as the tests do: nothing to drain.
    if (!signal) return;

    await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
  }
}
