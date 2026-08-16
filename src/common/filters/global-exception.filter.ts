import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Request, type Response } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import {
  ConflictDomainError,
  DomainError,
  DomainErrorCode,
  NotFoundDomainError,
} from '../errors/domain.errors';

/**
 * The single error shape every failing request produces, whatever went wrong.
 */
export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  /** Stable machine-readable identifier; branch on this, not on `message`. */
  code: string;
  message: string;
  details?: Record<string, unknown>;
  path: string;
  method: string;
  timestamp: string;
  /** Correlates this response with the server-side log entry. */
  requestId: string;
  /** Present only outside production, to keep debugging pleasant locally. */
  stack?: string;
}

/** PostgreSQL error codes worth translating into meaningful HTTP responses. */
const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

interface PostgresDriverError {
  code?: string;
  constraint?: string;
  detail?: string;
}

/**
 * Reason phrases for the statuses this API actually emits.
 *
 * An explicit table rather than reflection over the `HttpStatus` enum: it is
 * faster, it documents the API's status-code surface in one glance, and it
 * cannot accidentally match a reverse-mapped enum key.
 */
/**
 * `QueryFailedError` is generic, and `instanceof` narrowing on a generic class
 * widens the parameter to `any`. This guard pins it down so the driver error
 * stays properly typed on the way through.
 */
const isQueryFailedError = (error: unknown): error is QueryFailedError<Error> =>
  error instanceof QueryFailedError;

/**
 * Recognises the `ServiceUnavailableException` Terminus throws when a health
 * indicator fails.
 *
 * Detected by the payload's shape rather than by the request path, so it keeps
 * working if the health route is ever mounted somewhere else.
 */
const isHealthCheckException = (error: unknown): error is HttpException => {
  if (!(error instanceof HttpException)) return false;
  const payload = error.getResponse();
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'status' in payload &&
    'details' in payload &&
    'info' in payload
  );
};

const REASON_PHRASES: Readonly<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/**
 * Global exception filter.
 *
 * Deliberately implemented as one `@Catch()` filter rather than a stack of
 * per-type filters: ordering between multiple global filters is subtle, while a
 * single explicit dispatch is deterministic and directly unit-testable.
 *
 * Two guarantees it exists to uphold:
 *  1. Every error response has the same shape and an appropriate status code.
 *  2. Nothing sensitive ever reaches the client in production — unexpected
 *     errors become a generic 500 and the real detail goes to the logs only,
 *     correlated by `requestId`.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = randomUUID();

    // The health endpoint has its own well-known contract that monitoring
    // tools parse; reshaping it into the generic error envelope would break
    // them for no benefit.
    if (isHealthCheckException(exception)) {
      this.log(exception, exception.getStatus(), requestId, request);
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const resolved = this.resolve(exception);

    const body: ErrorResponseBody = {
      statusCode: resolved.statusCode,
      error: this.reasonPhrase(resolved.statusCode),
      code: resolved.code,
      message: resolved.message,
      ...(resolved.details ? { details: resolved.details } : {}),
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
      requestId,
    };

    if (!this.isProduction && exception instanceof Error && exception.stack) {
      body.stack = exception.stack;
    }

    this.log(exception, resolved.statusCode, requestId, request);

    response.status(resolved.statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof DomainError) {
      return this.fromDomainError(exception);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (isQueryFailedError(exception)) {
      return this.fromQueryFailedError(exception);
    }

    // TypeORM's `findOneOrFail` variants. Repositories in this codebase avoid
    // them, but a future caller should still get a 404 rather than a 500.
    if (exception instanceof EntityNotFoundError) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested resource was not found',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      // Never echo an unexpected error's message: it can carry SQL fragments,
      // file paths or connection strings.
      message: 'An unexpected internal error occurred',
    };
  }

  private fromDomainError(exception: DomainError): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    let statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
    if (exception instanceof NotFoundDomainError) statusCode = HttpStatus.NOT_FOUND;
    else if (exception instanceof ConflictDomainError) statusCode = HttpStatus.CONFLICT;

    return {
      statusCode,
      code: exception.code,
      message: exception.message,
      details: exception.details,
    };
  }

  /**
   * Normalises framework exceptions, most importantly the `BadRequestException`
   * that `ValidationPipe` throws with an array of messages.
   */
  private fromHttpException(exception: HttpException): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, code: this.defaultCodeFor(statusCode), message: payload };
    }

    const record = payload as { message?: string | string[]; error?: string };
    const rawMessage = record.message;

    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        code: 'VALIDATION_FAILED',
        message: `Request validation failed with ${rawMessage.length} error(s)`,
        details: { validationErrors: rawMessage },
      };
    }

    return {
      statusCode,
      code: this.defaultCodeFor(statusCode),
      message: rawMessage ?? exception.message,
    };
  }

  /**
   * Translates database constraint violations into meaningful responses.
   *
   * The service layer catches the cases it can anticipate and throws a domain
   * error with a better message; this is the safety net for everything else,
   * and it guarantees a constraint violation never surfaces as an opaque 500.
   */
  private fromQueryFailedError(exception: QueryFailedError<Error>): {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    const driverError = exception.driverError as PostgresDriverError | undefined;
    const constraint = driverError?.constraint;

    switch (driverError?.code) {
      case PG_ERROR_CODES.UNIQUE_VIOLATION:
        return {
          statusCode: HttpStatus.CONFLICT,
          code: this.codeForUniqueConstraint(constraint),
          message: 'A record with the same unique value already exists',
          details: constraint ? { constraint } : undefined,
        };

      case PG_ERROR_CODES.FOREIGN_KEY_VIOLATION:
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'FOREIGN_KEY_VIOLATION',
          message:
            'The operation violates a relationship constraint: the referenced record ' +
            'does not exist, or it is still referenced by other records',
          details: constraint ? { constraint } : undefined,
        };

      case PG_ERROR_CODES.CHECK_VIOLATION:
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'CHECK_CONSTRAINT_VIOLATION',
          message: 'The provided values violate a database integrity rule',
          details: constraint ? { constraint } : undefined,
        };

      case PG_ERROR_CODES.NOT_NULL_VIOLATION:
        return {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'NOT_NULL_VIOLATION',
          message: 'A required field was not provided',
        };

      case PG_ERROR_CODES.INVALID_TEXT_REPRESENTATION:
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'INVALID_VALUE_FORMAT',
          message: 'One of the provided values has an invalid format',
        };

      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'DATABASE_ERROR',
          // The raw SQL text lives in `exception.query`; it is logged, never returned.
          message: 'A database error occurred while processing the request',
        };
    }
  }

  /** Maps our named unique indexes back to a domain-meaningful code. */
  private codeForUniqueConstraint(constraint: string | undefined): string {
    if (constraint === 'ux_items_sku') return DomainErrorCode.SKU_ALREADY_EXISTS;
    if (constraint === 'ux_groups_name_lower') return DomainErrorCode.GROUP_NAME_ALREADY_EXISTS;
    return 'UNIQUE_CONSTRAINT_VIOLATION';
  }

  private defaultCodeFor(statusCode: number): string {
    return (
      this.reasonPhrase(statusCode)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_') || 'ERROR'
    );
  }

  private reasonPhrase(statusCode: number): string {
    return REASON_PHRASES[statusCode] ?? (statusCode >= 500 ? 'Internal Server Error' : 'Error');
  }

  /**
   * Server-side errors are logged with the full stack; client-side ones are
   * logged at warn level without noise. Both carry the `requestId` returned to
   * the caller, which is what makes a production incident traceable.
   */
  private log(exception: unknown, statusCode: number, requestId: string, request: Request): void {
    const context = `${request.method} ${request.url} -> ${statusCode} [${requestId}]`;

    if (statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(context, stack);
      if (exception instanceof QueryFailedError) {
        this.logger.error(`Failing query: ${exception.query}`);
      }
      return;
    }

    const message = exception instanceof Error ? exception.message : String(exception);
    this.logger.warn(`${context} ${message}`);
  }
}
