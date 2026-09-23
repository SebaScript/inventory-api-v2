import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { ExportUnavailableException } from '../common/exceptions';
import { Item } from '../entities/item.entity';
import { ObjectStorageService } from '../storage/object-storage.service';
import { toCsv } from './csv';

const PREFIX = 'exports';

export interface ExportResult {
  key: string;
  rows: number;
  bytes: number;
  url: string;
  expiresInSeconds: number;
}

@Injectable()
export class ExportsService {
  constructor(
    @InjectRepository(Item) private readonly items: Repository<Item>,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Snapshots the inventory to object storage and hands back a temporary link. */
  async exportItems(): Promise<ExportResult> {
    if (!this.storage.configured) throw new ExportUnavailableException();

    const items = await this.items.find({ relations: { group: true }, order: { id: 'ASC' } });
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
