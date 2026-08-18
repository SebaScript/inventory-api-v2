import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { InsufficientStockException } from '../src/common/exceptions';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { CreateGroupDto } from '../src/groups/group.dto';
import { CreateItemDto } from '../src/items/item.dto';

/**
 * The filter is what stands between an internal failure and the client, so it
 * is tested directly: no database, no HTTP, just "given this error, what comes
 * out". These are the security-relevant paths.
 */
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

/** Builds a QueryFailedError carrying a specific PostgreSQL error code. */
const pgError = (code: string) =>
  new QueryFailedError('INSERT INTO items ...', [], Object.assign(new Error('driver'), { code }));

describe('Error handling', () => {
  const dev = new HttpExceptionFilter(false);
  const prod = new HttpExceptionFilter(true);

  describe('domain exceptions', () => {
    it('maps a not-found exception to 404 with its code', () => {
      const { status, body } = capture(
        dev,
        new NotFoundException({ code: 'X_NOT_FOUND', message: 'gone' }),
      );
      expect(status).toBe(404);
      expect(body).toMatchObject({ code: 'X_NOT_FOUND', message: 'gone' });
    });

    it('carries the numbers a client needs to recover from insufficient stock', () => {
      const { status, body } = capture(dev, new InsufficientStockException(4, 3, 10));
      expect(status).toBe(409);
      expect(body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: 3, requested: 10 });
    });

    it('always attaches the path and a timestamp', () => {
      const { body } = capture(dev, new NotFoundException('nope'));
      expect(body.path).toBe('/movements');
      expect(new Date(body.timestamp as string).toISOString()).toBe(body.timestamp);
    });

    it('handles an exception whose payload is a plain string', () => {
      const { status, body } = capture(dev, new NotFoundException('plain'));
      expect(status).toBe(404);
      expect(body.message).toBe('plain');
    });
  });

  describe('validation failures', () => {
    it('reports the array of messages under a single code', () => {
      const { status, body } = capture(
        dev,
        new BadRequestException({ message: ['name must be longer', 'sku is required'] }),
      );
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.message).toHaveLength(2);
    });
  });

  describe('database errors never surface as a 500', () => {
    it.each([
      ['23505', 409, 'DUPLICATE_VALUE'],
      ['23503', 409, 'RELATED_RECORD'],
      ['23514', 422, 'INVALID_VALUE'],
    ])('maps PostgreSQL %s to %i', (code, expectedStatus, expectedCode) => {
      const { status, body } = capture(dev, pgError(code));
      expect(status).toBe(expectedStatus);
      expect(body.code).toBe(expectedCode);
    });

    it('falls back to 500 for an unrecognised database error', () => {
      const { status, body } = capture(prod, pgError('XX000'));
      expect(status).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('nothing sensitive leaks in production', () => {
    it('replaces an unexpected error with a generic message', () => {
      const leaky = new Error('connect failed: postgres://admin:hunter2@db:5432');
      const { status, body } = capture(prod, leaky);

      expect(status).toBe(500);
      expect(body.message).toBe('Internal server error');
      expect(JSON.stringify(body)).not.toContain('hunter2');
    });

    it('does show the detail outside production, so debugging stays pleasant', () => {
      const { body } = capture(dev, new Error('boom'));
      expect(String(body.message)).toContain('boom');
    });

    it('never echoes the failing SQL', () => {
      const { body } = capture(prod, pgError('XX000'));
      expect(JSON.stringify(body)).not.toContain('INSERT INTO');
    });
  });
});

/**
 * The `@Transform` helpers run before validation, so they receive whatever the
 * client sent. They must pass a wrong type through untouched, so the validator
 * produces a 400 instead of the request crashing on `.trim()` into a 500.
 */
describe('DTO transforms with wrongly typed input', () => {
  const errorsFor = <T extends object>(cls: new () => T, plain: object): string =>
    validateSync(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join(' ');

  it.each([
    ['CreateGroupDto.name', CreateGroupDto, { name: 42 }],
    ['CreateItemDto.name', CreateItemDto, { groupId: 1, name: 42, sku: 'OK' }],
    ['CreateItemDto.sku', CreateItemDto, { groupId: 1, name: 'Valid', sku: 99 }],
  ])('%s reports a validation error instead of throwing', (_label, cls, plain) => {
    expect(() => errorsFor(cls as never, plain)).not.toThrow();
    expect(errorsFor(cls as never, plain)).not.toBe('');
  });

  it('trims strings that are the right type', () => {
    const dto = plainToInstance(CreateGroupDto, { name: '  Tools  ' });
    expect(dto.name).toBe('Tools');
  });

  it('uppercases a SKU', () => {
    const dto = plainToInstance(CreateItemDto, { groupId: 1, name: 'Cable', sku: ' abc ' });
    expect(dto.sku).toBe('ABC');
  });
});
