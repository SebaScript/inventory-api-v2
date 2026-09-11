const NAMESPACE = 'InventoryApi';
const SERVICE = 'inventory-api';

/**
 * Builds a CloudWatch Embedded Metric Format document. A log line in this shape
 * is turned into real metrics at ingestion time, so the application publishes
 * metrics without the CloudWatch SDK, without an API call in the request path
 * and without any IAM permission of its own.
 *
 * Every name listed under Dimensions has to exist as a top-level string field.
 * Keep dimensions low cardinality: CloudWatch bills per metric per dimension
 * combination, so a dimension like an item id or a path is a cost incident.
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

/**
 * Written straight to stdout, bypassing the Nest logger on purpose: the logger
 * would nest this under a `message` field, `_aws` would no longer be at the top
 * level and CloudWatch would file it as an ordinary log line with no metric and
 * no error to explain why.
 */
export function emitCacheMetrics(hits: number, misses: number): void {
  process.stdout.write(`${JSON.stringify(cacheMetricsDocument(hits, misses))}\n`);
}
