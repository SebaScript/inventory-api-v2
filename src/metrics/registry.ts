import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Our own registry, so nothing a dependency registers leaks into /metrics. */
export const registry = new Registry();

registry.setDefaultLabels({ service: 'inventory-api' });
// Process memory, CPU and event loop lag.
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests handled, by route and outcome',
  // `route` is the pattern, never the URL: one series per route, not per id.
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'How long each request took, by route',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const cacheHits = new Counter({
  name: 'cache_hits_total',
  help: 'Listings served from the distributed cache',
  registers: [registry],
});

export const cacheMisses = new Counter({
  name: 'cache_misses_total',
  help: 'Listings that had to be read from the database',
  registers: [registry],
});

export const partnerLookups = new Counter({
  name: 'partner_lookups_total',
  help: 'Calls to the other cloud through the orchestrator, by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});
