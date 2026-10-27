import { NextFunction, Request, Response } from 'express';
import { release } from './release';

/** Past any latency objective, short of any client timeout. */
export const FAULT_DELAY_MS = 1500;

/**
 * Rehearses a bad release. On the canary only, `x-fault: error` answers 500 and
 * `x-fault: latency` answers late; the stable track ignores the header.
 */
export function faultInjection(request: Request, response: Response, next: NextFunction): void {
  const fault = release.track === 'canary' ? request.headers['x-fault'] : undefined;

  if (fault === 'latency') setTimeout(next, FAULT_DELAY_MS);
  else if (fault === 'error') {
    response.status(500).json({
      statusCode: 500,
      code: 'FAULT_INJECTED',
      message: 'This canary fails on purpose: the request carried x-fault: error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  } else next();
}
