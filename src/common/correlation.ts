import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
/** What many gateways and clients send instead. Accepted so callers are not forced to change. */
const ALTERNATE_HEADER = 'x-request-id';
/** Span attribute that carries the same id, searchable as `span.app.correlation_id`. */
export const CORRELATION_ATTRIBUTE = 'app.correlation_id';

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
    // Stamped on the request's span too, so a trace can be found in Tempo or
    // X-Ray by the id the other cloud logs. Without the OpenTelemetry SDK in
    // the process there is no active span and this does nothing.
    trace.getActiveSpan()?.setAttribute(CORRELATION_ATTRIBUTE, id);
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

/**
 * The OpenTelemetry trace id of the request in progress, for the log line.
 * Undefined when no SDK is loaded, which keeps it out of the logs entirely
 * rather than writing an empty field.
 */
export function currentTraceId(): string | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context && trace.isSpanContextValid(context) ? context.traceId : undefined;
}
