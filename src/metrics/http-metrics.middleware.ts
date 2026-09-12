import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { correlationIdOf } from '../common/correlation';
import { httpDuration, httpRequests } from './registry';

/** Probes and scrapes would drown out real traffic on every graph. */
const IGNORED = /^\/(health|metrics)/;

/**
 * Records one measurement and one access log line per request.
 *
 * Middleware rather than an interceptor because the work happens on the
 * response's `finish` event, which is the only place the status code is final:
 * an interceptor completes before the exception filter has written the error
 * response, so every failure would be counted as the handler's status.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  use(request: Request, response: Response, next: NextFunction): void {
    // `originalUrl` and not `path`: Express rewrites the url of mounted
    // middleware, so `path` does not reliably hold the route the client asked
    // for and the filter below would silently never match.
    if (IGNORED.test(request.originalUrl.split('?')[0])) return next();

    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      // The matched pattern, not the URL: `/v2/items/:id` is one time series,
      // `/v2/items/37` would be one per item.
      const route = request.route?.path ?? 'unmatched';
      const status = String(response.statusCode);

      httpRequests.inc({ method: request.method, route, status });
      httpDuration.observe({ method: request.method, route }, seconds);

      this.logger.log({
        method: request.method,
        route,
        url: request.originalUrl,
        status: response.statusCode,
        durationMs: Math.round(seconds * 1000),
        correlationId: correlationIdOf(request),
      });
    });

    next();
  }
}
