const NAMESPACE = 'InventoryApi';
const SERVICE = 'inventory-api';

/**
 * CloudWatch Embedded Metric Format: a log line CloudWatch turns into metrics.
 * No SDK, no API call, no IAM permission.
 */
export function cacheMetricsDocument(hits: number, misses: number, now = Date.now()): object {
  const total = hits + misses;

  return {
    _aws: {
      Timestamp: now,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [['Service']],
          Metrics: [
            { Name: 'CacheHits', Unit: 'Count' },
            { Name: 'CacheMisses', Unit: 'Count' },
            { Name: 'CacheHitRatio', Unit: 'Percent' },
          ],
        },
      ],
    },
    Service: SERVICE,
    CacheHits: hits,
    CacheMisses: misses,
    CacheHitRatio: total === 0 ? 0 : Math.round((hits / total) * 100),
  };
}

/** Straight to stdout: the Nest logger would nest `_aws` and CloudWatch would ignore it. */
export function emitCacheMetrics(hits: number, misses: number): void {
  process.stdout.write(`${JSON.stringify(cacheMetricsDocument(hits, misses))}\n`);
}
