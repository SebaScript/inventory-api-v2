import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createApp, reset } from './app.factory';

describe('Correlation', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
  });
  beforeEach(() => reset(dataSource));
  afterAll(() => app.close());

  it('keeps the id the caller sent, so a trace survives the hop between services', async () => {
    const res = await api.get('/v2/items').set('x-correlation-id', 'orchestrator-1').expect(200);
    expect(res.headers['x-correlation-id']).toBe('orchestrator-1');
  });

  it('accepts x-request-id too, which is what many gateways send', async () => {
    const res = await api.get('/v2/items').set('x-request-id', 'gateway-9').expect(200);
    expect(res.headers['x-correlation-id']).toBe('gateway-9');
  });

  it('generates one when nobody sends it, so there is always something to trace by', async () => {
    const res = await api.get('/v2/items').expect(200);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers a failure with the same id as the request that caused it', async () => {
    const res = await api.get('/items/999').set('x-correlation-id', 'failing-call').expect(404);
    expect(res.headers['x-correlation-id']).toBe('failing-call');
  });
});

describe('Metrics endpoint', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let api: Awaited<ReturnType<typeof createApp>>['api'];

  beforeAll(async () => {
    ({ app, dataSource, api } = await createApp());
    await reset(dataSource);
  });
  afterAll(() => app.close());

  it('publishes the series an external Prometheus expects', async () => {
    await api.get('/v2/items').expect(200);
    const res = await api.get('/metrics').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('cache_hits_total');
    // Default process metrics, which is what most Grafana dashboards start from.
    expect(res.text).toContain('process_resident_memory_bytes');
  });

  it('labels by route pattern, not by url, so ids cannot multiply the series', async () => {
    await api.get('/items/111').expect(404);
    await api.get('/items/222').expect(404);

    const { text } = await api.get('/metrics').expect(200);
    const series = text.split('\n').filter((l) => l.startsWith('http_requests_total{'));

    expect(series.some((l) => l.includes('route="/items/:id"'))).toBe(true);
    expect(series.some((l) => l.includes('/items/111'))).toBe(false);
  });

  it('leaves probes and scrapes out, so they cannot drown the real traffic', async () => {
    await api.get('/health/live').expect(200);
    await api.get('/health').expect(200);

    const { text } = await api.get('/metrics').expect(200);
    const series = text.split('\n').filter((l) => l.startsWith('http_requests_total{'));

    expect(series.some((l) => l.includes('route="/health'))).toBe(false);
    expect(series.some((l) => l.includes('route="/metrics"'))).toBe(false);
  });

  it('stays out of the published documentation', async () => {
    const { body } = await api.get('/docs-json').expect(200);
    expect(body.paths).not.toHaveProperty('/metrics');
  });
});
