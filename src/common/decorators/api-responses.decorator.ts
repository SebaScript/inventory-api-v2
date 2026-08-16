import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { PaginatedResponseDto, PaginationMeta } from '../dto/paginated-response.dto';

/**
 * Documents the error responses every endpoint can produce, so the Swagger page
 * reflects reality instead of only listing happy paths.
 */
export const ApiCommonErrors = (...extra: Array<400 | 404 | 409 | 422>) => {
  const descriptions: Record<number, string> = {
    400: 'Malformed request: invalid path parameter, query parameter or body',
    404: 'The referenced resource does not exist',
    409: 'The request conflicts with the current state of the resource',
    422: 'The request is well formed but violates a domain or integrity rule',
  };

  const responses = [...new Set<number>([400, ...extra])].map((status) =>
    ApiResponse({ status, description: descriptions[status], type: ErrorResponseDto }),
  );

  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ...responses,
    ApiResponse({
      status: 500,
      description: 'Unexpected internal error. Never contains stack traces in production.',
      type: ErrorResponseDto,
    }),
  );
};

/**
 * Documents a paginated list response for a concrete item type.
 *
 * `PaginatedResponseDto` is generic, and generics are erased at runtime, so the
 * schema has to be composed explicitly for Swagger to show the real payload.
 */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  description = 'Paginated list',
) =>
  applyDecorators(
    ApiExtraModels(PaginatedResponseDto, PaginationMeta, model),
    ApiResponse({
      status: 200,
      description,
      schema: {
        allOf: [
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
              meta: { $ref: getSchemaPath(PaginationMeta) },
            },
            required: ['data', 'meta'],
          },
        ],
      },
    }),
  );
