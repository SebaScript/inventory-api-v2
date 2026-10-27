import { NextFunction, Request, Response } from 'express';

/** What `/api/...` without a version serves: the newest version this build has. */
export const CURRENT_API_VERSION = 'v3';

/** `/api/v2/...`, `/api/v2?x=1` and a bare `/api/v2`, but never `/api/version`. */
const VERSIONED = /^\/api\/v\d+(?=[/?]|$)/;
const UNVERSIONED = /^\/api(?=\/)/;

/**
 * Serves `/api/v2/...` as well as `/v2/...` by rewriting the url before
 * routing, so nothing already calling `/v2` breaks.
 */
export function apiAlias(request: Request, _response: Response, next: NextFunction): void {
  if (VERSIONED.test(request.url)) request.url = request.url.slice('/api'.length);
  else if (UNVERSIONED.test(request.url)) {
    request.url = `/${CURRENT_API_VERSION}${request.url.slice('/api'.length)}`;
  }
  next();
}
