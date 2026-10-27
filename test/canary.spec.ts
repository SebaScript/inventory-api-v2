import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FAULT_DELAY_MS } from '../src/common/fault';
import { release } from '../src/common/release';
import { trackMetrics } from '../src/metrics/cloudwatch.publisher';
import { createApp, reset } from './app.factory';

describe('Canary', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterEach(() => (release.track = 'stable'));
  afterAll(() => app.close());

  describe('fault injection', () => {
    it('is ignored by the stable track', async () => {
      await api.get('/api/v2/items').set('x-fault', 'error').expect(200);
    });

    it('makes the canary fail, still saying who failed', async () => {
      release.track = 'canary';
      const res = await api.get('/api/v2/items').set('x-fault', 'error').expect(500);

      expect(res.body.code).toBe('FAULT_INJECTED');
      expect(res.headers['x-app-track']).toBe('canary');
      await api.get('/api/v2/items').expect(200);
    });

    it('makes the canary slow', async () => {
      release.track = 'canary';
      const started = Date.now();
      await api.get('/api/v2/items').set('x-fault', 'latency').expect(200);

      expect(Date.now() - started).toBeGreaterThanOrEqual(FAULT_DELAY_MS);
    });
  });

  describe('business metric', () => {
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

    it('reaches CloudWatch per track, in megabytes', () => {
      const [memory, movements] = trackMetrics('canary', 64 * 2 ** 20, 3);

      expect(memory).toMatchObject({ MetricName: 'MemoryUsedMB', Value: 64, Unit: 'Megabytes' });
      expect(movements).toMatchObject({ MetricName: 'MovementsRecorded', Value: 3 });
      expect(movements.Dimensions).toEqual([{ Name: 'Track', Value: 'canary' }]);
    });
  });
});
