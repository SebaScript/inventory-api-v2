import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextFunction, Request, Response } from 'express';

const { version } = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { version: string };

/** Which build answered, and on which side of the canary split it runs. */
export const release = {
  version,
  track: process.env.APP_TRACK === 'canary' ? 'canary' : 'stable',
};

/** On every response, errors and docs included: each request shows who served it. */
export function releaseHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('X-App-Version', release.version);
  response.setHeader('X-App-Track', release.track);
  next();
}
