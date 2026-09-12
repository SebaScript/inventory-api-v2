import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
/** What many gateways and clients send instead. Accepted so callers are not forced to change. */
const ALTERNATE_HEADER = 'x-request-id';

/**
 * Gives every request an id that survives the hop between services.
 *
 * An orchestrator in front of several APIs is only debuggable if one identifier
 * follows the call through all of them, so an incoming id is always honoured
 * and only generated when there is none. It goes back on the response too, so
 * the caller can quote it.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.headers[CORRELATION_HEADER] ?? request.headers[ALTERNATE_HEADER];
    const id = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();

    request.headers[CORRELATION_HEADER] = id;
    response.setHeader(CORRELATION_HEADER, id);
    next();
  }
}

/**
 * Reads the id back out wherever only the request is in hand, such as a filter.
 * Tolerates a request with no headers at all: this is called from the exception
 * filter, which is the one place that must never throw.
 */
export function correlationIdOf(request: Request): string | undefined {
  const value = request?.headers?.[CORRELATION_HEADER];
  return typeof value === 'string' ? value : undefined;
}
