import { plainToInstance } from 'class-transformer';
import { type ValidationError, validateSync } from 'class-validator';
import { CreateGroupDto } from '../../modules/groups/dto/create-group.dto';
import { QueryGroupsDto } from '../../modules/groups/dto/query-groups.dto';
import { CreateItemDto } from '../../modules/items/dto/create-item.dto';
import { QueryItemsDto } from '../../modules/items/dto/query-items.dto';
import { SearchItemsDto } from '../../modules/items/dto/search-items.dto';
import { CreateMovementDto } from '../../modules/movements/dto/create-movement.dto';
import { MovementType } from '../../modules/movements/entities/movement.entity';
import { numericTransformer } from '../database/numeric.transformer';
import { PaginatedResponseDto } from './paginated-response.dto';

const build = <T extends object>(cls: new () => T, plain: Record<string, unknown>): T =>
  plainToInstance(cls, plain, { enableImplicitConversion: false });

/** Flattens validation errors, including those nested inside child objects. */
const flatten = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flatten(error.children ?? []),
  ]);

const errorsFor = <T extends object>(cls: new () => T, plain: Record<string, unknown>): string =>
  flatten(validateSync(build(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).join(
    ' ',
  );

/**
 * The `@Transform` helpers run before validation and therefore receive whatever
 * the client sent, including values of the wrong type. They must pass those
 * through untouched so the validator can produce a meaningful message, rather
 * than crashing on `.trim()` and turning a 400 into a 500.
 */
describe('DTO transforms with non-string input', () => {
  it.each([
    ['CreateGroupDto.name', CreateGroupDto, { name: 42 }],
    ['CreateItemDto.name', CreateItemDto, { groupId: 1, name: 42, sku: 'OK-1' }],
    ['CreateItemDto.sku', CreateItemDto, { groupId: 1, name: 'Valid', sku: 99 }],
    [
      'CreateMovementDto.reason',
      CreateMovementDto,
      { itemId: 1, type: MovementType.IN, quantity: 1, reason: 42 },
    ],
    ['QueryGroupsDto.search', QueryGroupsDto, { search: 42 }],
    ['QueryItemsDto.search', QueryItemsDto, { search: 42 }],
    ['SearchItemsDto.text', SearchItemsDto, { text: 42 }],
  ])('%s reports a validation error instead of throwing', (_label, cls, plain) => {
    expect(() => errorsFor(cls as never, plain)).not.toThrow();
    expect(errorsFor(cls as never, plain)).not.toBe('');
  });

  it('leaves a null description untouched so it can clear the field', () => {
    const dto = build(CreateGroupDto, { name: 'Valid', description: null });
    expect(dto.description).toBeNull();
  });
});

describe('QueryItemsDto boolean coercion', () => {
  it.each([
    ['true', true],
    [true, true],
    ['false', false],
    [false, false],
  ])('coerces %p to %p', (raw, expected) => {
    expect(build(QueryItemsDto, { lowStock: raw }).lowStock).toBe(expected);
  });

  it('rejects a value that is neither, rather than guessing', () => {
    expect(errorsFor(QueryItemsDto, { lowStock: 'maybe' })).toContain('lowStock');
  });
});

describe('SearchItemsDto', () => {
  it('computes the offset from page and pageSize', () => {
    expect(build(SearchItemsDto, { page: 3, pageSize: 25 }).skip).toBe(50);
  });

  it('applies defaults for an empty body', () => {
    const dto = build(SearchItemsDto, {});
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto.skip).toBe(0);
  });

  it('rejects an empty groupIds array as a meaningless filter', () => {
    expect(errorsFor(SearchItemsDto, { groupIds: [] })).toContain('groupIds');
  });

  it('rejects more than 100 group ids', () => {
    const groupIds = Array.from({ length: 101 }, (_, index) => index + 1);
    expect(errorsFor(SearchItemsDto, { groupIds })).toContain('groupIds');
  });

  it('rejects more than four sort criteria', () => {
    const sort = Array.from({ length: 5 }, () => ({ field: 'name', order: 'asc' }));
    expect(errorsFor(SearchItemsDto, { sort })).toContain('sort');
  });

  it('rejects a negative range bound', () => {
    expect(errorsFor(SearchItemsDto, { price: { min: -1 } })).not.toBe('');
  });
});

describe('numericTransformer', () => {
  it('converts the string PostgreSQL returns into a number', () => {
    expect(numericTransformer.from('19.99')).toBe(19.99);
  });

  it('preserves null rather than turning it into 0', () => {
    // Number(null) is 0, which would silently invent a price of zero.
    expect(numericTransformer.from(null)).toBeNull();
  });

  it('preserves undefined', () => {
    expect(numericTransformer.from(undefined)).toBeNull();
  });

  it('passes values through unchanged on write', () => {
    expect(numericTransformer.to(19.99)).toBe(19.99);
  });
});

describe('PaginatedResponseDto edge cases', () => {
  it('does not divide by zero when pageSize is zero', () => {
    const { meta } = new PaginatedResponseDto([], 10, 1, 0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
  });
});
