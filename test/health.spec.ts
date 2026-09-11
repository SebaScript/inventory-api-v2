import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp } from './app.factory';

describe('Health probes', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  afterAll(() => app.close());

  it('answers liveness without the database, so a database blip cannot restart the pod', async () => {
    const spy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('down'));

    // This is the whole argument for splitting the probes: the process is
    // healthy, it just cannot serve.
    expect((await api.get('/health/live').expect(200)).body).toEqual({ status: 'ok' });
    await api.get('/health/ready').expect(503);
    await api.get('/health').expect(503);

    spy.mockRestore();
    await api.get('/health/ready').expect(200);
  });

  it('keeps the original /health contract', async () => {
    expect((await api.get('/health').expect(200)).body).toEqual({
      status: 'ok',
      database: 'up',
    });
  });
});
