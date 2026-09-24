import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { correlationIdOf, currentTraceId } from '../common/correlation';
import { httpDuration, httpRequests } from './registry';

/** Probes and scrapes would drown out real traffic. */
const IGNORED = /^\/(health|metrics)/;

/**
 * One metric and one access log per request, measured on `finish`: the only
 * point where the status is final, even for errors written by the filter.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Request');

  use(request: Request, response: Response, next: NextFunction): void {
    // `originalUrl`: Express rewrites `path` inside mounted middleware.
    if (IGNORED.test(request.originalUrl.split('?')[0])) return next();

    const startedAt = process.hrtime.bigint();
    // Read now: on `finish` the span is no longer active.
    const traceId = currentTraceId();

    response.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      // The pattern, not the URL: one time series per route, not per id.
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
        traceId,
      });
    });

    next();
  }
}
