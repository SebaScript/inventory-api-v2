import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PaginatedResponseDto } from './paginated-response.dto';
import { MAX_PAGE_SIZE, PaginationQueryDto, SortOrder } from './pagination-query.dto';

/** Mirrors the global ValidationPipe configuration from `main.ts`. */
const validateQuery = <T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): { instance: T; errors: string[] } => {
  const instance = plainToInstance(cls, plain, { enableImplicitConversion: false });
  const errors = validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));

  return { instance, errors };
};

describe('PaginationQueryDto', () => {
  it('applies defaults when nothing is supplied', () => {
    const { instance, errors } = validateQuery(PaginationQueryDto, {});

    expect(errors).toEqual([]);
    expect(instance.page).toBe(1);
    expect(instance.pageSize).toBe(20);
    expect(instance.sortOrder).toBe(SortOrder.ASC);
  });

  it('converts numeric strings from the query string', () => {
    const { instance, errors } = validateQuery(PaginationQueryDto, { page: '3', pageSize: '50' });

    expect(errors).toEqual([]);
    expect(instance.page).toBe(3);
    expect(instance.pageSize).toBe(50);
  });

  it('computes the offset from the validated page and size', () => {
    const { instance } = validateQuery(PaginationQueryDto, { page: '4', pageSize: '25' });
    expect(instance.skip).toBe(75);
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '-1' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ pageSize: '0' }, 'pageSize'],
    [{ pageSize: '1.5' }, 'pageSize'],
  ])('rejects %j', (plain, field) => {
    const { errors } = validateQuery(PaginationQueryDto, plain);
    expect(errors.join(' ')).toContain(field);
  });

  it(`caps pageSize at ${MAX_PAGE_SIZE} so an unbounded result set cannot be requested`, () => {
    const { errors } = validateQuery(PaginationQueryDto, { pageSize: String(MAX_PAGE_SIZE + 1) });
    expect(errors.join(' ')).toContain('pageSize');

    const atLimit = validateQuery(PaginationQueryDto, { pageSize: String(MAX_PAGE_SIZE) });
    expect(atLimit.errors).toEqual([]);
  });

  it('rejects a sortOrder outside the enum', () => {
    const { errors } = validateQuery(PaginationQueryDto, { sortOrder: 'sideways' });
    expect(errors.join(' ')).toContain('sortOrder must be one of');
  });

  it('rejects unknown properties instead of silently ignoring them', () => {
    const { errors } = validateQuery(PaginationQueryDto, { limit: '10' });
    expect(errors.join(' ')).toContain('limit');
  });
});

describe('PaginatedResponseDto', () => {
  it('computes navigation flags for a middle page', () => {
    const { meta } = new PaginatedResponseDto([1, 2], 45, 2, 20);

    expect(meta).toEqual({
      page: 2,
      pageSize: 20,
      total: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('reports no next page on the final page', () => {
    const { meta } = new PaginatedResponseDto([1], 41, 3, 20);
    expect(meta).toMatchObject({ totalPages: 3, hasNextPage: false, hasPreviousPage: true });
  });

  it('reports neither direction for an empty result set', () => {
    const { meta } = new PaginatedResponseDto([], 0, 1, 20);
    expect(meta).toMatchObject({ totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  });

  it('rounds partial pages up', () => {
    expect(new PaginatedResponseDto([], 21, 1, 20).meta.totalPages).toBe(2);
    expect(new PaginatedResponseDto([], 40, 1, 20).meta.totalPages).toBe(2);
  });
});
