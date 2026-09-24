import { Injectable, NestMiddleware } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
const ALTERNATE_HEADER = 'x-request-id';
/** Searchable in Tempo as `span.app.correlation_id`. */
export const CORRELATION_ATTRIBUTE = 'app.correlation_id';

/** One id per message, across both clouds: honoured if sent, generated if not. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.headers[CORRELATION_HEADER] ?? request.headers[ALTERNATE_HEADER];
    const id = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();

    request.headers[CORRELATION_HEADER] = id;
    response.setHeader(CORRELATION_HEADER, id);
    // Links the trace to the id. A no-op without the OpenTelemetry SDK.
    trace.getActiveSpan()?.setAttribute(CORRELATION_ATTRIBUTE, id);
    next();
  }
}

/** Never throws: the exception filter calls it. */
export function correlationIdOf(request: Request): string | undefined {
  const value = request?.headers?.[CORRELATION_HEADER];
  return typeof value === 'string' ? value : undefined;
}

/** The current trace id, or undefined without the SDK. */
export function currentTraceId(): string | undefined {
  const context = trace.getActiveSpan()?.spanContext();
  return context && trace.isSpanContextValid(context) ? context.traceId : undefined;
}
