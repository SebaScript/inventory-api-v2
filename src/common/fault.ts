import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/** Past any latency objective, short of any client timeout. */
export const FAULT_DELAY_MS = 1500;

/** How much later the call to the other cloud leaves under `partner-latency`. */
export const PARTNER_FAULT_DELAY_MS = 2000;

/** How long a report holds its database connection under `slow-db`. */
export const SLOW_QUERY_SECONDS = 2;

export type Fault = 'error' | 'latency' | 'slow-db' | 'partner-latency';
const FAULTS: readonly string[] = ['error', 'latency', 'slow-db', 'partner-latency'];

/**
 * The fault a request asks for, honoured only with the token the chaos
 * experiments carry: an open switch would let anyone slow the API down.
 * Without FAULT_TOKEN, nothing can be injected at all.
 */
export function requestedFault(request: Request): Fault | undefined {
  const token = process.env.FAULT_TOKEN;
  const fault = request.headers['x-fault'];
  const given = request.headers['x-fault-token'];

  if (!token || typeof fault !== 'string' || typeof given !== 'string') return undefined;
  if (!FAULTS.includes(fault) || !sameSecret(given, token)) return undefined;
  return fault as Fault;
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The faults that act on the whole request. `slow-db` and `partner-latency`
 * are applied where they bite: the report query and the call to the other cloud.
 */
export function faultInjection(request: Request, response: Response, next: NextFunction): void {
  const fault = requestedFault(request);

  if (fault === 'latency') setTimeout(next, FAULT_DELAY_MS);
  else if (fault === 'error') {
    response.status(500).json({
      statusCode: 500,
      code: 'FAULT_INJECTED',
      message: 'This request fails on purpose: it carried x-fault: error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  } else next();
}
