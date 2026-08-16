import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import {
  DomainError,
  DomainErrorCode,
  GroupNotEmptyError,
  GroupNotFoundError,
  InsufficientStockError,
  SkuAlreadyExistsError,
} from '../errors/domain.errors';
import { GlobalExceptionFilter, type ErrorResponseBody } from './global-exception.filter';

/** Builds an ArgumentsHost that captures whatever the filter writes. */
const buildHost = (
  method = 'POST',
  url = '/movements',
): { host: ArgumentsHost; captured: () => { status: number; body: ErrorResponseBody } } => {
  let status = 0;
  let body = {} as ErrorResponseBody;

  const response = {
    status: (code: number) => {
      status = code;
      return response;
    },
    json: (payload: ErrorResponseBody) => {
      body = payload;
      return response;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method, url }),
    }),
  } as unknown as ArgumentsHost;

  return { host, captured: () => ({ status, body }) };
};

/** Fabricates a QueryFailedError carrying a specific PostgreSQL error code. */
const pgError = (code: string, constraint?: string): QueryFailedError => {
  const driverError = Object.assign(new Error('driver failure'), { code, constraint });
  return new QueryFailedError('INSERT INTO items ...', [], driverError);
};

describe('GlobalExceptionFilter', () => {
  beforeAll(() => {
    // The filter logs deliberately; silence it so test output stays readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  describe('domain errors', () => {
    it('maps a not-found domain error to 404 with its code and details', () => {
      const { host, captured } = buildHost('GET', '/groups/99');
      new GlobalExceptionFilter(false).catch(new GroupNotFoundError(99), host);

      const { status, body } = captured();
      expect(status).toBe(HttpStatus.NOT_FOUND);
      expect(body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        code: 'GROUP_NOT_FOUND',
        details: { groupId: 99 },
        path: '/groups/99',
        method: 'GET',
      });
    });

    it('maps a conflict domain error to 409', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new GroupNotEmptyError(1), host);

      expect(captured().status).toBe(HttpStatus.CONFLICT);
      expect(captured().body.code).toBe('GROUP_NOT_EMPTY');
    });

    it('carries the numbers a client needs to recover from insufficient stock', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new InsufficientStockError(4, 3, 10), host);

      const { status, body } = captured();
      expect(status).toBe(409);
      expect(body.code).toBe('INSUFFICIENT_STOCK');
      expect(body.details).toEqual({ itemId: 4, available: 3, requested: 10 });
      expect(body.message).toContain('3 unit(s) available');
    });

    it('maps a duplicate SKU to 409', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new SkuAlreadyExistsError('ABC-1'), host);

      expect(captured().status).toBe(409);
      expect(captured().body.code).toBe('SKU_ALREADY_EXISTS');
    });
  });

  describe('framework exceptions', () => {
    it('flattens ValidationPipe message arrays into details.validationErrors', () => {
      const { host, captured } = buildHost();
      const exception = new BadRequestException({
        statusCode: 400,
        message: ['name must be a string', 'quantity must be greater than 0'],
        error: 'Bad Request',
      });

      new GlobalExceptionFilter(false).catch(exception, host);

      const { status, body } = captured();
      expect(status).toBe(400);
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.message).toBe('Request validation failed with 2 error(s)');
      expect(body.details?.validationErrors).toEqual([
        'name must be a string',
        'quantity must be greater than 0',
      ]);
    });

    it('preserves a single-string HttpException message', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new NotFoundException('Cannot GET /nope'), host);

      expect(captured().status).toBe(404);
      expect(captured().body.message).toBe('Cannot GET /nope');
    });

    it('handles an HttpException carrying a plain string payload', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new HttpException('teapot', 418), host);

      expect(captured().status).toBe(418);
      expect(captured().body.message).toBe('teapot');
    });

    it('derives a code from the status when none is supplied', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new ConflictException(), host);

      expect(captured().body.code).toBe('CONFLICT');
    });
  });

  describe('health check responses', () => {
    it('passes a Terminus payload through untouched, preserving its contract', () => {
      const { host, captured } = buildHost('GET', '/health');
      const terminusPayload = {
        status: 'error',
        info: {},
        error: { database: { status: 'down' } },
        details: { database: { status: 'down' } },
      };

      new GlobalExceptionFilter(true).catch(new HttpException(terminusPayload, 503), host);

      const { status, body } = captured();
      expect(status).toBe(503);
      // Not reshaped into the generic error envelope: monitoring tools parse this.
      expect(body).toEqual(terminusPayload);
    });

    it('still normalises a 503 that is not a health payload', () => {
      const { host, captured } = buildHost('GET', '/items');
      new GlobalExceptionFilter(false).catch(new HttpException('upstream down', 503), host);

      expect(captured().body).toMatchObject({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'upstream down',
      });
    });
  });

  describe('database errors', () => {
    it('maps a unique violation on the SKU index to a domain-meaningful 409', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23505', 'ux_items_sku'), host);

      expect(captured().status).toBe(409);
      expect(captured().body.code).toBe('SKU_ALREADY_EXISTS');
    });

    it('maps a unique violation on the group name index', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23505', 'ux_groups_name_lower'), host);

      expect(captured().body.code).toBe('GROUP_NAME_ALREADY_EXISTS');
    });

    it('falls back to a generic code for an unrecognised unique index', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23505', 'ux_something_else'), host);

      expect(captured().body.code).toBe('UNIQUE_CONSTRAINT_VIOLATION');
    });

    it('maps a foreign key violation to 409', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23503', 'fk_items_group'), host);

      expect(captured().status).toBe(409);
      expect(captured().body.code).toBe('FOREIGN_KEY_VIOLATION');
    });

    it('maps a CHECK violation to 422', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23514', 'chk_items_quantity'), host);

      expect(captured().status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(captured().body.code).toBe('CHECK_CONSTRAINT_VIOLATION');
    });

    it('maps a NOT NULL violation to 422', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23502'), host);

      expect(captured().status).toBe(422);
      expect(captured().body.code).toBe('NOT_NULL_VIOLATION');
    });

    it('maps an invalid text representation to 400', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('22P02'), host);

      expect(captured().status).toBe(400);
      expect(captured().body.code).toBe('INVALID_VALUE_FORMAT');
    });

    it('never leaks the failing SQL for an unrecognised database error', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(true).catch(pgError('XX000'), host);

      const { status, body } = captured();
      expect(status).toBe(500);
      expect(body.code).toBe('DATABASE_ERROR');
      expect(JSON.stringify(body)).not.toContain('INSERT INTO items');
    });

    it('maps TypeORM EntityNotFoundError to 404', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new EntityNotFoundError('Item', { id: 1 }), host);

      expect(captured().status).toBe(404);
      expect(captured().body.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('unexpected errors and information disclosure', () => {
    it('returns a generic 500 without echoing the original message', () => {
      const { host, captured } = buildHost();
      const leaky = new Error('connect ECONNREFUSED postgres://admin:hunter2@db:5432');

      new GlobalExceptionFilter(true).catch(leaky, host);

      const { status, body } = captured();
      expect(status).toBe(500);
      expect(body.message).toBe('An unexpected internal error occurred');
      expect(JSON.stringify(body)).not.toContain('hunter2');
    });

    it('omits the stack trace in production', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(true).catch(new Error('boom'), host);

      expect(captured().body.stack).toBeUndefined();
    });

    it('includes the stack trace outside production, for local debugging', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new Error('boom'), host);

      expect(captured().body.stack).toContain('Error: boom');
    });

    it('handles a thrown non-Error value without crashing', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch('a bare string', host);

      expect(captured().status).toBe(500);
      expect(captured().body.stack).toBeUndefined();
    });
  });

  describe('defensive branches', () => {
    it('falls back to 422 for a domain error that is neither not-found nor conflict', () => {
      // A future error family should degrade sensibly rather than become a 500.
      class UnclassifiedError extends DomainError {
        readonly code = DomainErrorCode.INSUFFICIENT_STOCK;
        constructor() {
          super('Something the domain rejects');
        }
      }

      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new UnclassifiedError(), host);

      expect(captured().status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('falls back to the exception message when the payload carries none', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new HttpException({ error: 'Odd' }, 400), host);

      expect(captured().body.message).toBeDefined();
      expect(captured().body.message).not.toBe('');
    });

    it('omits details when the database error names no constraint', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23505'), host);

      expect(captured().status).toBe(409);
      expect(captured().body).not.toHaveProperty('details');
    });

    it('omits details for a constraint-less foreign key violation', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23503'), host);

      expect(captured().body).not.toHaveProperty('details');
    });

    it('omits details for a constraint-less check violation', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(pgError('23514'), host);

      expect(captured().body).not.toHaveProperty('details');
    });

    it('produces a usable reason phrase for a status outside the known table', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new HttpException('gone', 410), host);

      expect(captured().body.error).toBe('Error');
      expect(captured().body.code).toBe('ERROR');
    });

    it('names a 5xx outside the table as an internal server error', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new HttpException('bad gateway', 502), host);

      expect(captured().body.error).toBe('Internal Server Error');
    });
  });

  describe('response envelope', () => {
    it('always includes a correlation id and an ISO timestamp', () => {
      const { host, captured } = buildHost('DELETE', '/items/1');
      new GlobalExceptionFilter(false).catch(new GroupNotFoundError(1), host);

      const { body } = captured();
      expect(body.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
      expect(body.method).toBe('DELETE');
      expect(body.path).toBe('/items/1');
    });

    it('gives every response a distinct correlation id', () => {
      const first = buildHost();
      const second = buildHost();
      const filter = new GlobalExceptionFilter(false);

      filter.catch(new GroupNotFoundError(1), first.host);
      filter.catch(new GroupNotFoundError(1), second.host);

      expect(first.captured().body.requestId).not.toBe(second.captured().body.requestId);
    });

    it('omits the details key entirely when there is nothing to report', () => {
      const { host, captured } = buildHost();
      new GlobalExceptionFilter(false).catch(new Error('boom'), host);

      expect(captured().body).not.toHaveProperty('details');
    });
  });
});
