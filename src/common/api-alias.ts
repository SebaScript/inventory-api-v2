import { NextFunction, Request, Response } from 'express';

/** `/api/v2/...`, `/api/v2?x=1` and a bare `/api/v2`, but never `/api/version`. */
const VERSIONED = /^\/api\/v\d+(?=[/?]|$)/;

/**
 * Serves `/api/v2/...` as well as `/v2/...` by rewriting the url before
 * routing, so nothing already calling `/v2` breaks.
 */
export function apiAlias(request: Request, _response: Response, next: NextFunction): void {
  if (VERSIONED.test(request.url)) request.url = request.url.slice('/api'.length);
  next();
}
