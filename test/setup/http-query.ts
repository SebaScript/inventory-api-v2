import request, { type Test } from 'supertest';

/** Whatever supertest accepts as its target: an http.Server, an app or a URL. */
export type TestServer = Parameters<typeof request>[0];

/**
 * Issues a real `QUERY` request through supertest.
 *
 * At runtime supertest builds one method function per entry of Node's
 * `http.METHODS`, which includes `QUERY` on Node 22+ — so `agent.query(path)`
 * genuinely dispatches `QUERY path`, exactly like `agent.post(path)` dispatches
 * a POST.
 *
 * Its published types, however, predate the method and resolve `.query` to
 * superagent's *query-string* setter, which returns the agent rather than a
 * `Test`. This helper is the single place where that mismatch is bridged, so
 * the specs stay readable and the cast is explained once instead of repeated.
 */
export const queryRequest = (server: TestServer, path: string): Test => {
  const agent = request(server) as unknown as Record<string, (url: string) => Test>;
  return agent.query(path);
};
