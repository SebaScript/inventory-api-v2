import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FAULT_DELAY_MS } from '../src/common/fault';
import {
  EXPORT_STATEMENT_TIMEOUT_MS,
  MAX_CONCURRENT_EXPORTS,
} from '../src/exports/exports.service';
import {
  PARTNER_OUTCOMES,
  minuteMetrics,
  valuesAndCounts,
} from '../src/metrics/cloudwatch.publisher';
import { ObjectStorageService } from '../src/storage/object-storage.service';
import { createApp, reset } from './app.factory';

const TOKEN = 'chaos-test-token';

const storage = {
  configured: true,
  put: (_key: string, body: string) =>
    Promise.resolve({ bytes: body.length, url: 'https://bucket/x', expiresInSeconds: 900 }),
} as unknown as ObjectStorageService;

describe('Fault switch', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    process.env.FAULT_TOKEN = TOKEN;
    ({ app, dataSource, api } = await createApp(undefined, storage));
  });
  beforeEach(() => reset(dataSource));
  afterAll(async () => {
    delete process.env.FAULT_TOKEN;
    await app.close();
  });

  it('is ignored without the token, so nobody outside the experiments can trip it', async () => {
    await api.get('/api/v2/items').set('x-fault', 'error').expect(200);
    await api
      .get('/api/v2/items')
      .set('x-fault', 'error')
      .set('x-fault-token', 'guess')
      .expect(200);
  });

  it('fails the request on purpose, and only that request', async () => {
    const res = await api
      .get('/api/v2/items')
      .set('x-fault', 'error')
      .set('x-fault-token', TOKEN)
      .expect(500);

    expect(res.body.code).toBe('FAULT_INJECTED');
    await api.get('/api/v2/items').expect(200);
  });

  it('answers late', async () => {
    const started = Date.now();
    await api
      .get('/api/v2/items')
      .set('x-fault', 'latency')
      .set('x-fault-token', TOKEN)
      .expect(200);

    expect(Date.now() - started).toBeGreaterThanOrEqual(FAULT_DELAY_MS);
  });

  it('makes a report hold its connection, until the statement timeout gives it back', async () => {
    const started = Date.now();
    const res = await api
      .post('/v2/exports/items')
      .set('x-fault', 'slow-db')
      .set('x-fault-token', TOKEN)
      .expect(503);

    expect(res.body.code).toBe('EXPORT_TIMEOUT');
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(EXPORT_STATEMENT_TIMEOUT_MS);
    expect(took).toBeLessThan(2 * EXPORT_STATEMENT_TIMEOUT_MS);
  });

  it('refuses at once the reports beyond the bulkhead, and the reads stay fast', async () => {
    const rejected = async () =>
      Number(/^exports_rejected_total\S* (\d+)/m.exec((await api.get('/metrics')).text)?.[1]);
    const before = await rejected();
    const slowReport = () =>
      api.post('/v2/exports/items').set('x-fault', 'slow-db').set('x-fault-token', TOKEN);

    // then(): supertest only sends a request once it is awaited.
    const running = Array.from({ length: MAX_CONCURRENT_EXPORTS }, () =>
      slowReport().then((r) => r),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    const started = Date.now();
    const extra = await slowReport();
    const read = await api.get('/api/v2/items').expect(200);

    expect(extra.status).toBe(503);
    expect(extra.body.code).toBe('EXPORT_BUSY');
    expect(read.body).toBeDefined();
    expect(Date.now() - started).toBeLessThan(EXPORT_STATEMENT_TIMEOUT_MS / 2);
    expect((await Promise.all(running)).map((r) => r.body.code)).toEqual(
      Array(MAX_CONCURRENT_EXPORTS).fill('EXPORT_TIMEOUT'),
    );
    expect((await rejected()) - before).toBe(1);
  });

  it('runs a normal report as before', async () => {
    await api.post('/v2/exports/items').expect(201);
  });

  it('ignores a fault it does not know', async () => {
    await api.get('/api/v2/items').set('x-fault', 'meteor').set('x-fault-token', TOKEN).expect(200);
  });
});

describe('Business metric', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  it('counts every movement recorded, and only those', async () => {
    const recorded = async () =>
      Number(/^movements_recorded_total\S* (\d+)/m.exec((await api.get('/metrics')).text)?.[1]);
    const before = await recorded();

    await api.post('/groups').send({ name: 'Tools' }).expect(201);
    await api.post('/items').send({ groupId: 1, name: 'Hammer', sku: 'H1' }).expect(201);
    await api.post('/movements').send({ itemId: 1, type: 'IN', quantity: 5 }).expect(201);
    await api.post('/movements').send({ itemId: 1, type: 'OUT', quantity: 9 }).expect(409);

    expect((await recorded()) - before).toBe(1);
  });
});

describe('CloudWatch minute', () => {
  it('sends memory in megabytes and every partner outcome, zero included', () => {
    const data = minuteMetrics(64 * 2 ** 20, 3, { ok: 5 }, []);

    expect(data[0]).toMatchObject({ MetricName: 'MemoryUsedMB', Value: 64, Unit: 'Megabytes' });
    expect(data[1]).toMatchObject({ MetricName: 'MovementsRecorded', Value: 3 });
    expect(data[2]).toMatchObject({ MetricName: 'ReportsRejected', Value: 0 });
    const outcomes = data.filter((d) => d.MetricName === 'PartnerCalls');
    expect(outcomes.map((d) => [d.Dimensions?.[0].Value, d.Value])).toEqual(
      PARTNER_OUTCOMES.map((o) => [o, o === 'ok' ? 5 : 0]),
    );
    expect(data.some((d) => d.MetricName === 'PartnerCallDuration')).toBe(false);
  });

  it('sends the raw call durations, so CloudWatch computes the p95 itself', () => {
    const data = minuteMetrics(0, 0, {}, [40, 40, 2000]);

    expect(data.at(-1)).toMatchObject({
      MetricName: 'PartnerCallDuration',
      Values: [40, 2000],
      Counts: [2, 1],
    });
  });

  it('coarsens the values until CloudWatch accepts them', () => {
    const { Values, Counts } = valuesAndCounts(Array.from({ length: 1000 }, (_, i) => i));

    expect(Values.length).toBeLessThanOrEqual(150);
    expect(Counts.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});
