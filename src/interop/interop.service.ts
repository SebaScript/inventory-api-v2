import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CORRELATION_HEADER } from '../common/correlation';
import { Item, ItemStatus } from '../entities/item.entity';
import { partnerLookups } from '../metrics/registry';
import { InteropRecord, PartnerLookup, SERVICE_NAME } from './interop.contract';

/** Short on purpose: this runs inside a GET, so it must never hold the response. */
const DEFAULT_TIMEOUT_MS = 1_500;

@Injectable()
export class InteropService {
  private readonly logger = new Logger('Interop');

  constructor(@InjectRepository(Item) private readonly items: Repository<Item>) {}

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
   * Asks the orchestrator for a random record from the other cloud.
   *
   * Never throws and never propagates a failure: an unreachable partner
   * degrades to `unavailable`, so the local read still answers.
   */
  async fetchPartnerRecord(correlationId?: string): Promise<PartnerLookup> {
    if (!this.partnerConfigured) return { status: 'disabled', record: null };

    const base = process.env.ORCHESTRATOR_URL!.replace(/\/$/, '');
    const url = `${base}/interop/${process.env.PARTNER_KEY}/random`;
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

      partnerLookups.inc({ outcome: 'ok' });
      return { status: 'ok', record };
    } catch (error) {
      return this.unavailable((error as Error).message, correlationId);
    }
  }

  private unavailable(reason: string, correlationId?: string): PartnerLookup {
    partnerLookups.inc({ outcome: 'unavailable' });
    this.logger.warn({ message: 'Partner lookup failed', reason, correlationId });
    return { status: 'unavailable', record: null };
  }
}
