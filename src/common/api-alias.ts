import { NextFunction, Request, Response } from 'express';

/** `/api/v2/...`, `/api/v2?x=1` and a bare `/api/v2`, but never `/api/version`. */
const VERSIONED = /^\/api\/v\d+(?=[/?]|$)/;

/**
 * Serves every versioned route under `/api/v2` as well as `/v2`.
 *
 * Nest's URI versioning produces exactly one prefix, so pointing it at
 * `api/v` would move the routes rather than add to them and break every
 * caller already aimed at `/v2` — the gateway, the other cloud's
 * orchestrator and the published collection among them.
 *
 * Rewriting the url before the router sees it gives both spellings for free.
 * `originalUrl` keeps whichever the client actually used, and the matched
 * pattern stays `/v2/items/:id`, so the two spellings share one time series
 * instead of splitting every metric in half.
 */
export function apiAlias(request: Request, _response: Response, next: NextFunction): void {
  if (VERSIONED.test(request.url)) request.url = request.url.slice('/api'.length);
  next();
}
