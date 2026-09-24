import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { emitCacheMetrics } from '../common/metrics';
import { cacheHits, cacheMisses } from '../metrics/registry';

/** Namespaces are the unit of invalidation. */
export const ITEMS_NAMESPACE = 'items';
export const PARTNER_NAMESPACE = 'partner';

/** A hit carries the value; every read returns the epoch to write back with. */
export interface CacheRead<T> {
  value?: T;
  epoch: string;
}

/** Stored shape: the epoch it was written under, plus the payload. */
interface Entry {
  e: string;
  d: unknown;
}

const METRICS_INTERVAL_MS = 60_000;
const ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Optional distributed cache: without REDIS_URL every read is a miss and the
 * API serves from the database.
 *
 * Invalidation bumps an epoch counter per namespace (one INCR) instead of
 * scanning keys, which would block the cache node.
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
    // Read here, not at module scope: dotenv loads after this file is imported.
    const url = process.env.REDIS_URL;
    if (!url) return;

    this.client = new Redis(url, {
      // Fail fast: queueing would turn a cache outage into a latency outage.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    });

    // Without a listener, an `error` event crashes Node.
    this.client.on('error', (error: Error) => this.logThrottled(error));

    if (process.env.NODE_ENV === 'production') {
      this.metricsTimer = setInterval(() => this.flushMetrics(), METRICS_INTERVAL_MS);
      this.metricsTimer.unref();
    }
  }

  get enabled(): boolean {
    return this.client !== undefined;
  }

  /** Entry and epoch in one round trip. */
  async read<T>(namespace: string, key: string): Promise<CacheRead<T>> {
    if (!this.client) return { epoch: '0' };

    try {
      const [epoch, raw] = await this.client.mget(this.epochKey(namespace), `${namespace}:${key}`);
      const current = epoch ?? '0';

      if (raw) {
        const entry = JSON.parse(raw) as Entry;
        // Written before the last invalidation: a miss.
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

  /** Stored under the epoch read earlier: a write in between just makes it stale. */
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

  /** Invalidates a whole namespace. */
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
      // quit() can hang mid-reconnect.
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

  /** At most one line a minute during an outage. */
  private logThrottled(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) return;

    this.lastErrorLoggedAt = now;
    this.logger.warn(`Cache unavailable, serving from the database: ${error.message}`);
  }
}
