import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { QueryFailedError, Repository } from 'typeorm';
import {
  ExportBusyException,
  ExportTimeoutException,
  ExportUnavailableException,
} from '../common/exceptions';
import { SLOW_QUERY_SECONDS } from '../common/fault';
import { Item } from '../entities/item.entity';
import { exportsRejected } from '../metrics/registry';
import { ObjectStorageService } from '../storage/object-storage.service';
import { toCsv } from './csv';

const PREFIX = 'exports';

/**
 * Bulkhead: reports running at once on one replica. The pool holds 5
 * connections, so at least 3 always stay free for the reads.
 */
export const MAX_CONCURRENT_EXPORTS = 2;

/** No report holds its connection longer than this. */
export const EXPORT_STATEMENT_TIMEOUT_MS = 1_000;

/** PostgreSQL's code for a statement cancelled by statement_timeout. */
const QUERY_CANCELED = '57014';

export interface ExportResult {
  key: string;
  rows: number;
  bytes: number;
  url: string;
  expiresInSeconds: number;
}

@Injectable()
export class ExportsService {
  private running = 0;

  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * Snapshots the inventory to object storage and hands back a temporary link.
   * `slow` is the injected fault: the report holds its connection for seconds.
   */
  async exportItems(slow = false): Promise<ExportResult> {
    if (!this.storage.configured) throw new ExportUnavailableException();
    if (this.running >= MAX_CONCURRENT_EXPORTS) {
      exportsRejected.inc();
      throw new ExportBusyException(MAX_CONCURRENT_EXPORTS);
    }

    this.running += 1;
    try {
      return await this.snapshot(slow);
    } finally {
      this.running -= 1;
    }
  }

  private async snapshot(slow: boolean): Promise<ExportResult> {
    // One transaction: the sleep and the read share a pooled connection, as a slow report would.
    // SET LOCAL: the timeout covers this report only, and ends with its transaction.
    const items = await this.items.manager
      .transaction(async (manager) => {
        await manager.query(`SET LOCAL statement_timeout = ${EXPORT_STATEMENT_TIMEOUT_MS}`);
        if (slow) await manager.query('SELECT pg_sleep($1)', [SLOW_QUERY_SECONDS]);
        return manager.find(Item, { relations: { group: true }, order: { id: 'ASC' } });
      })
      .catch((error: unknown) => {
        const code = (error as QueryFailedError & { driverError?: { code?: string } }).driverError
          ?.code;
        if (error instanceof QueryFailedError && code === QUERY_CANCELED) {
          throw new ExportTimeoutException(EXPORT_STATEMENT_TIMEOUT_MS);
        }
        throw error;
      });
    const body = toCsv(items);
    const key = `${PREFIX}/items-${new Date().toISOString()}-${randomUUID()}.csv`;

    const stored = await this.storage.put(key, body, 'text/csv; charset=utf-8');

    return {
      key,
      rows: items.length,
      bytes: stored.bytes,
      url: stored.url,
      expiresInSeconds: stored.expiresInSeconds,
    };
  }
}
