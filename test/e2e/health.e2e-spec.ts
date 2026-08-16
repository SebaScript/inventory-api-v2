import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type DataSource } from 'typeorm';
import { type TestApp, createTestApp } from '../setup/test-app.factory';

describe('Health check (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: TestApp['server'];

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    dataSource = testApp.dataSource;
    server = testApp.server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ok with the database up', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
      details: { database: { status: 'up' } },
    });
    expect(response.body.error).toEqual({});
  });

  it('actually probes PostgreSQL rather than reporting ok unconditionally', async () => {
    const pingSpy = jest.spyOn(dataSource, 'query');

    await request(server).get('/health').expect(200);

    expect(pingSpy).toHaveBeenCalled();
    pingSpy.mockRestore();
  });

  it('degrades to 503 when the database is unreachable', async () => {
    // The health indicator issues a ping through the DataSource; making it fail
    // is what a real outage looks like from the endpoint's point of view.
    const pingSpy = jest
      .spyOn(dataSource, 'query')
      .mockRejectedValue(new Error('connection terminated unexpectedly'));

    const response = await request(server).get('/health').expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.error.database.status).toBe('down');

    pingSpy.mockRestore();
  });

  it('never leaks connection details in the degraded response', async () => {
    const pingSpy = jest
      .spyOn(dataSource, 'query')
      .mockRejectedValue(new Error('password authentication failed for user "admin"'));

    const response = await request(server).get('/health').expect(503);

    expect(JSON.stringify(response.body)).not.toContain('password authentication failed');

    pingSpy.mockRestore();
  });

  it('recovers once the database responds again', async () => {
    const pingSpy = jest.spyOn(dataSource, 'query').mockRejectedValue(new Error('down'));
    await request(server).get('/health').expect(503);
    pingSpy.mockRestore();

    await request(server).get('/health').expect(200);
  });
});
