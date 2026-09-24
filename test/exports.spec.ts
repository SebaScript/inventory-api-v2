import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Item } from '../src/entities/item.entity';
import { toCsv } from '../src/exports/csv';
import { cacheMetricsDocument } from '../src/common/metrics';
import { createApp, reset } from './app.factory';

const item = (over: Partial<Item> = {}): Item =>
  ({
    id: 1,
    sku: 'C1',
    name: 'Cable',
    quantity: 5,
    minimumStock: 1,
    unitPrice: 2.5,
    status: 'ACTIVE',
    updatedAt: new Date('2026-09-10T21:00:00.000Z'),
    ...over,
  }) as Item;

describe('CSV snapshot', () => {
  it('quotes every field and doubles interior quotes', () => {
    const csv = toCsv([item({ name: 'Cable, 2m "long"' })]);

    expect(csv.split('\r\n')[0]).toContain('"id","sku","name"');
    expect(csv).toContain('"Cable, 2m ""long"""');
  });

  it('neutralises a value a spreadsheet would run as a formula', () => {
    // An item name is free text, so this is reachable from the public API.
    expect(toCsv([item({ name: '=1+1' })])).toContain(`"'=1+1"`);
    expect(toCsv([item({ name: '@SUM(A1)' })])).toContain(`"'@SUM(A1)"`);
  });

  it('terminates rows with CRLF and emits only a header when there is nothing', () => {
    expect(toCsv([])).toBe(
      '"id","sku","name","group","quantity","minimumStock","unitPrice","status","updatedAt"\r\n',
    );
    expect(toCsv([item()]).endsWith('\r\n')).toBe(true);
  });
});

describe('Embedded metric format', () => {
  it('puts the metric directives at the top level, on one line', () => {
    const doc = cacheMetricsDocument(8, 2, 1_757_620_000_000) as Record<string, unknown>;
    const aws = doc._aws as { CloudWatchMetrics: { Namespace: string; Dimensions: string[][] }[] };

    expect(aws.CloudWatchMetrics[0].Namespace).toBe('InventoryApi');
    // Every declared dimension has to exist as a top-level field.
    expect(aws.CloudWatchMetrics[0].Dimensions).toEqual([['Service']]);
    expect(doc.Service).toBe('inventory-api');
    expect(doc.CacheHitRatio).toBe(80);
    expect(JSON.stringify(doc)).not.toContain('\n');
  });
});

describe('Exports', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  it('refuses clearly when object storage is not configured', async () => {
    // No S3_BUCKET in tests: the real offline path, not a mock.
    const res = await api.post('/v2/exports/items').expect(503);
    expect(res.body.code).toBe('EXPORT_UNAVAILABLE');
  });

  it('is documented and lives outside the items resource', async () => {
    const { body } = await api.get('/docs-json').expect(200);

    expect(body.paths['/v2/exports/items'].post.tags).toEqual(['Exports v2']);
    expect(body.paths['/v2/items/{id}']).not.toHaveProperty('export');
  });
});
