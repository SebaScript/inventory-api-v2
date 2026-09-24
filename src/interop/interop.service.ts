import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { CacheService, PARTNER_NAMESPACE } from '../cache/cache.service';
import { CORRELATION_HEADER } from '../common/correlation';
import { Item, ItemStatus } from '../entities/item.entity';
import { partnerLookups } from '../metrics/registry';
import { ObjectStorageService } from '../storage/object-storage.service';
import {
  FlowAttachment,
  FlowMessage,
  InteropRecord,
  PartnerLookup,
  SERVICE_NAME,
} from './interop.contract';

/** Runs inside a GET: it must never hold the response. */
const DEFAULT_TIMEOUT_MS = 1_500;

/** Short: the partner returns a random record, so a long TTL would freeze one. */
const DEFAULT_CACHE_TTL_SECONDS = 30;

@Injectable()
export class InteropService {
  private readonly logger = new Logger('Interop');

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    private readonly cache: CacheService,
    private readonly storage: ObjectStorageService,
  ) {}

  get partnerConfigured(): boolean {
    return Boolean(process.env.ORCHESTRATOR_URL && process.env.PARTNER_KEY);
  }

  /** One random active item. `ORDER BY RANDOM()` is fine at this table size. */
  async randomLocalRecord(): Promise<InteropRecord | null> {
    const item = await this.items
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.group', 'group')
      .where('item.status = :status', { status: ItemStatus.ACTIVE })
      .orderBy('RANDOM()')
      .limit(1)
      .getOne();

    return item ? toRecord(item) : null;
  }

  async localRecord(id: number): Promise<InteropRecord | null> {
    const item = await this.items.findOne({ where: { id }, relations: { group: true } });
    return item ? toRecord(item) : null;
  }

  /**
   * A record from the other cloud, through the cache. Never throws: a failure
   * degrades to `unavailable`. Only successes are cached, so an outage does not
   * outlive itself.
   */
  async fetchPartnerRecord(correlationId?: string): Promise<PartnerLookup> {
    if (!this.partnerConfigured) return { status: 'disabled', record: null };

    const partner = process.env.PARTNER_KEY!;
    const { value, epoch } = await this.cache.read<InteropRecord>(PARTNER_NAMESPACE, partner);
    if (value) {
      partnerLookups.inc({ outcome: 'cached' });
      return { status: 'ok', record: value };
    }

    const base = process.env.ORCHESTRATOR_URL!.replace(/\/$/, '');
    const url = `${base}/interop/${partner}/random`;
    const timeout = Number(process.env.INTEROP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

    const headers: Record<string, string> = { Accept: 'application/json' };
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
   * This API's step in the flow: appends an item to the message and stores the
   * accumulated JSON in S3. Only appends, so no step erases another's.
   */
  async appendToMessage(
    message: Record<string, unknown>,
    correlationId?: string,
    itemId?: number,
  ): Promise<FlowMessage | null> {
    const record =
      itemId === undefined ? await this.randomLocalRecord() : await this.localRecord(itemId);
    if (!record) return null;

    const entities = Array.isArray(message.entities) ? message.entities : [];
    const attachments = Array.isArray(message.attachments)
      ? (message.attachments as FlowAttachment[])
      : [];
    const id = typeof message.correlationId === 'string' ? message.correlationId : correlationId;

    const accumulated = { ...message, correlationId: id, entities: [...entities, record] };
    if (!this.storage.configured) return { ...accumulated, attachments };

    const key = `flows/${safeSegment(id ?? randomUUID())}/${new Date().toISOString()}-${SERVICE_NAME}.json`;
    const stored = await this.storage.put(key, JSON.stringify(accumulated), 'application/json');

    return {
      ...accumulated,
      attachments: [
        ...attachments,
        { source: SERVICE_NAME, key, url: stored.url, expiresInSeconds: stored.expiresInSeconds },
      ],
    };
  }

  /** Forces the next read back to the other cloud: one INCR. */
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

/** The id comes from another cloud and ends up in an S3 key: no `/` or `..`. */
function safeSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/[.]{2,}/g, '_')
    .replace(/^[.]/, '_')
    .slice(0, 128);
}

function toRecord(item: Item): InteropRecord {
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
