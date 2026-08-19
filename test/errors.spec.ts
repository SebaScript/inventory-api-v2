import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { InsufficientStockException } from '../src/common/exceptions';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';

function capture(filter: HttpExceptionFilter, error: unknown) {
  let status = 0;
  let body: Record<string, unknown> = {};

  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return this;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', url: '/movements' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(error, host);
  return { status, body };
}

const pgError = (code: string) =>
  new QueryFailedError('INSERT INTO items ...', [], Object.assign(new Error('driver'), { code }));

describe('Error handling', () => {
  const dev = new HttpExceptionFilter(false);
  const prod = new HttpExceptionFilter(true);

  it('gives every failure the same shape, keeping the numbers a client needs', () => {
    const notFound = capture(dev, new NotFoundException({ code: 'X_NOT_FOUND', message: 'gone' }));
    expect(notFound.status).toBe(404);
    expect(notFound.body).toMatchObject({ code: 'X_NOT_FOUND', message: 'gone' });
    expect(notFound.body.path).toBe('/movements');
    expect(new Date(notFound.body.timestamp as string).toISOString()).toBe(notFound.body.timestamp);

    const stock = capture(dev, new InsufficientStockException(4, 3, 10));
    expect(stock.status).toBe(409);
    expect(stock.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 3, requested: 10 });

    expect(capture(dev, new NotFoundException('plain')).body.message).toBe('plain');
  });

  it('reports the list of validation messages under one code', () => {
    const { status, body } = capture(
      dev,
      new BadRequestException({ message: ['name must be longer', 'sku is required'] }),
    );
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toHaveLength(2);
  });

  it('turns a database constraint violation into a client error, not a 500', () => {
    expect(capture(dev, pgError('23505')).status).toBe(409); // unique violation
    expect(capture(dev, pgError('23503')).status).toBe(409); // foreign key
    expect(capture(dev, pgError('23514')).status).toBe(422); // CHECK constraint
    expect(capture(dev, pgError('23514')).body.code).toBe('INVALID_VALUE');
  });

  it('never leaks internals in production, but shows them in development', () => {
    const leaky = new Error('connect failed: postgres://admin:hunter2@db:5432');

    const hidden = capture(prod, leaky);
    expect(hidden.status).toBe(500);
    expect(hidden.body.message).toBe('Internal server error');
    expect(JSON.stringify(hidden.body)).not.toContain('hunter2');

    expect(JSON.stringify(capture(prod, pgError('XX000')).body)).not.toContain('INSERT INTO');

    expect(String(capture(dev, leaky).body.message)).toContain('hunter2');
  });
});
