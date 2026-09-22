import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService, PARTNER_NAMESPACE } from '../cache/cache.service';
import { CORRELATION_HEADER } from '../common/correlation';
import { Item, ItemStatus } from '../entities/item.entity';
import { partnerLookups } from '../metrics/registry';
import { InteropRecord, PartnerLookup, SERVICE_NAME } from './interop.contract';

/** Short on purpose: this runs inside a GET, so it must never hold the response. */
const DEFAULT_TIMEOUT_MS = 1_500;

/**
 * How long a record from the other cloud may be reused.
 *
 * Short because the partner returns a *random* record each time, so a long TTL
 * would freeze the same one on screen and make a live demo look broken. Long
 * enough that a burst of reads does not become a burst of cross-cloud calls.
 */
const DEFAULT_CACHE_TTL_SECONDS = 30;

@Injectable()
export class InteropService {
  private readonly logger = new Logger('Interop');

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    private readonly cache: CacheService,
  ) {}

  get partnerConfigured(): boolean {
    return Boolean(process.env.ORCHESTRATOR_URL && process.env.PARTNER_KEY);
  }

  /**
   * One random active item, mapped to the shared shape.
   *
   * `ORDER BY RANDOM()` scans the table, which is the right trade-off for a
   * catalogue of this size and the wrong one for millions of rows; the usual
   * replacement is picking a random id within the known range.
   */
  async randomLocalRecord(): Promise<InteropRecord | null> {
    const item = await this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.group', 'group')
      .where('item.status = :status', { status: ItemStatus.ACTIVE })
      .orderBy('RANDOM()')
      .limit(1)
      .getOne();

    if (!item) return null;

    return {
      source: SERVICE_NAME,
      kind: 'item',
      id: String(item.id),
      label: item.name,
      attributes: {
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        group: item.group?.name ?? null,
      },
      retrievedAt: new Date().toISOString(),
    };
  }

  /**
   * Asks the orchestrator for a record from the other cloud, through the cache.
   *
   * Never throws and never propagates a failure: an unreachable partner
   * degrades to `unavailable`, so the local read still answers.
   *
   * Only successful lookups are cached. Storing a failure would stretch a
   * momentary outage across the whole TTL, which is the opposite of what a
   * cache is for.
   */
  async fetchPartnerRecord(correlationId?: string): Promise<PartnerLookup> {
    if (!this.partnerConfigured) return { status: 'disabled', record: null };

    const partner = process.env.PARTNER_KEY!;
    // Keyed by partner, so a second cloud gets its own entry rather than
    // overwriting this one.
    const { value, epoch } = await this.cache.read<InteropRecord>(PARTNER_NAMESPACE, partner);
    if (value) {
      // Counted apart from `ok`: the cross-cloud panel would otherwise look
      // like the integration had gone quiet whenever the cache was working.
      partnerLookups.inc({ outcome: 'cached' });
      return { status: 'ok', record: value };
    }

    const base = process.env.ORCHESTRATOR_URL!.replace(/\/$/, '');
    const url = `${base}/interop/${partner}/random`;
    const timeout = Number(process.env.INTEROP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = { Accept: 'application/json' };
    // Propagated so one identifier follows the call through both clouds.
    if (correlationId) headers[CORRELATION_HEADER] = correlationId;
    if (process.env.ORCHESTRATOR_API_KEY) {
      headers['x-api-key'] = process.env.ORCHESTRATOR_API_KEY;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        return this.unavailable(`orchestrator answered ${response.status}`, correlationId);
      }

      const record = (await response.json()) as InteropRecord;
      if (!record?.source || !record?.id) {
        return this.unavailable('orchestrator answered an unexpected shape', correlationId);
      }

      const ttl = Number(process.env.PARTNER_CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS);
      await this.cache.write(PARTNER_NAMESPACE, partner, epoch, record, ttl);

      partnerLookups.inc({ outcome: 'ok' });
      return { status: 'ok', record };
    } catch (error) {
      return this.unavailable((error as Error).message, correlationId);
    }
  }

  /**
   * Drops the cached partner records so the next read goes back to the other
   * cloud. One INCR, whatever the number of entries.
   *
   * Exists because the TTL bounds how stale a record can get, but nothing else
   * can force a refresh: after the partner changes a record, this is what makes
   * the change visible immediately instead of up to a TTL later.
   */
  async invalidatePartnerCache(): Promise<{ invalidated: boolean }> {
    await this.cache.bump(PARTNER_NAMESPACE);
    return { invalidated: this.cache.enabled };
  }

  private unavailable(reason: string, correlationId?: string): PartnerLookup {
    partnerLookups.inc({ outcome: 'unavailable' });
    this.logger.warn({ message: 'Partner lookup failed', reason, correlationId });
    return { status: 'unavailable', record: null };
  }
}
