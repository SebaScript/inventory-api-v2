import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { emitCacheMetrics } from '../common/metrics';
import { cacheHits, cacheMisses } from '../metrics/registry';

/**
 * Namespaces are the unit of invalidation. Declared here, next to the cache, so
 * the services that invalidate never have to import from a controller.
 */
export const ITEMS_NAMESPACE = 'items';
/** Records fetched from the other cloud. Separate epoch, so invalidating one
 * does not throw away the other. */
export const PARTNER_NAMESPACE = 'partner';

/** What a read returns: the value when it is a hit, and always the epoch to write back. */
export interface CacheRead<T> {
  value?: T;
  epoch: string;
}

/** Stored shape: the epoch the entry was written under, plus the payload. */
interface Entry {
  e: string;
  d: unknown;
}

const METRICS_INTERVAL_MS = 60_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * A distributed cache that is always optional. Without REDIS_URL no client is
 * constructed at all, and every method answers as a miss, so the API keeps
 * serving from the database and the test suite needs no cache server.
 *
 * Invalidation is an epoch counter per namespace rather than a key scan: a
 * write is one INCR, and stale entries are ignored on read and expire by TTL.
 * Scanning the keyspace to delete matching keys blocks the whole cache node.
 */
@Injectable()
export class CacheService implements OnApplicationShutdown {
  private readonly logger = new Logger('Cache');
  private readonly client?: Redis;
  private readonly metricsTimer?: NodeJS.Timeout;

  private hits = 0;
  private misses = 0;
  private lastErrorLoggedAt = 0;

  constructor() {
    // Read the environment here, not at module scope: dotenv is loaded inside
    // app.module.ts, which runs after this file has been imported.
    const url = process.env.REDIS_URL;
    if (!url) return;

    this.client = new Redis(url, {
      // Fail the command instead of queueing it until the cache comes back.
      // Queueing turns a cache outage into a latency outage.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });

    // Without this listener an `error` event is unhandled and Node exits, so a
    // cache outage would crash-loop the pods.
    this.client.on('error', (error: Error) => this.logThrottled(error));

    if (process.env.NODE_ENV === 'production') {
      this.metricsTimer = setInterval(() => this.flushMetrics(), METRICS_INTERVAL_MS);
      // An un-unref'd timer keeps the event loop alive: it hangs Jest and
      // delays pod shutdown.
      this.metricsTimer.unref();
    }
  }

  get enabled(): boolean {
    return this.client !== undefined;
  }

  /** Reads the entry and its namespace epoch in a single round trip. */
  async read<T>(namespace: string, key: string): Promise<CacheRead<T>> {
    if (!this.client) return { epoch: '0' };

    try {
      const [epoch, raw] = await this.client.mget(this.epochKey(namespace), `${namespace}:${key}`);
      const current = epoch ?? '0';

      if (raw) {
        const entry = JSON.parse(raw) as Entry;
        // An entry written before the last invalidation is a miss, not a value.
        if (entry.e === current) {
          this.hits += 1;
          cacheHits.inc();
          return { value: entry.d as T, epoch: current };
        }
      }

      this.misses += 1;
      cacheMisses.inc();
      return { epoch: current };
    } catch (error) {
      this.logThrottled(error as Error);
      return { epoch: '0' };
    }
  }

  /**
   * Stores the value against the epoch that was current when the read happened.
   * A write that lands in between leaves this entry stale, so the next read
   * discards it: the race can waste an entry, it cannot serve stale data.
   */
  async write(
    namespace: string,
    key: string,
    epoch: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.client) return;

    try {
      const entry: Entry = { e: epoch, d: value };
      await this.client.set(`${namespace}:${key}`, JSON.stringify(entry), 'EX', ttlSeconds);
    } catch (error) {
      this.logThrottled(error as Error);
    }
  }

  /** Invalidates a whole namespace in one operation. */
  async bump(namespace: string): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.incr(this.epochKey(namespace));
    } catch (error) {
      this.logThrottled(error as Error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (!this.client) return;

    try {
      await this.client.quit();
    } catch {
      // quit() can hang on a client that is mid-reconnect, and a hung shutdown
      // hook means the pod is killed instead of stopping cleanly.
      this.client.disconnect();
    }
  }

  private epochKey(namespace: string): string {
    return `${namespace}:epoch`;
  }

  private flushMetrics(): void {
    if (this.hits + this.misses === 0) return;

    emitCacheMetrics(this.hits, this.misses);
    this.hits = 0;
    this.misses = 0;
  }

  /** One line a minute: a long outage must not flood the log with one line per request. */
  private logThrottled(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;

    this.lastErrorLoggedAt = now;
    this.logger.warn(`Cache unavailable, serving from the database: ${error.message}`);
  }
}
