import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

/** PostgreSQL error codes worth translating into a meaningful status. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

/**
 * Handles exceptions and converts them to a consistent JSON response.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, code, message, extra } = this.describe(exception);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception as Error);
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      ...extra,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private describe(exception: unknown): {
    status: number;
    code: string;
    message: string | string[];
    extra?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, code: this.codeFor(status), message: payload };
      }

      // Nest's own statusCode/error are dropped; this response sets its own.
      const { code, message, statusCode, error, ...extra } = payload as Record<string, unknown>;

      return {
        status,
        // ValidationPipe returns an array of messages and no code of its own.
        code:
          (code as string) ?? (Array.isArray(message) ? 'VALIDATION_FAILED' : this.codeFor(status)),
        message: (message as string | string[]) ?? exception.message,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      };
    }

    // A constraint violation is bad client data, not a server fault.
    if (exception instanceof QueryFailedError) {
      const driverCode = (exception.driverError as { code?: string })?.code;

      if (driverCode === UNIQUE_VIOLATION) {
        return {
          status: HttpStatus.CONFLICT,
          code: 'DUPLICATE_VALUE',
          message: 'That value is already taken',
        };
      }
      if (driverCode === FOREIGN_KEY_VIOLATION) {
        return {
          status: HttpStatus.CONFLICT,
          code: 'RELATED_RECORD',
          message: 'A related record blocks this operation',
        };
      }
      if (driverCode === CHECK_VIOLATION) {
        return {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          code: 'INVALID_VALUE',
          message: 'A value breaks a database rule',
        };
      }
    }

    // Never echo an unexpected error: it can contain SQL or a connection string.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: this.isProduction ? 'Internal server error' : String(exception),
    };
  }

  private codeFor(status: number): string {
    return HttpStatus[status] ?? 'ERROR';
  }
}
