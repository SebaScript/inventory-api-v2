import { type ValueTransformer } from 'typeorm';

/**
 * PostgreSQL `numeric`/`decimal` columns are returned as strings by the `pg`
 * driver, because they can hold values outside the range JavaScript numbers can
 * represent exactly.
 *
 * Monetary amounts in this API are bounded (`numeric(12, 2)`), so they fit in a
 * double without loss. This transformer converts them to `number` on read so
 * the rest of the codebase — and the JSON responses — never leak a
 * surprising `"19.99"` string where a number is expected.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null =>
    value === null || value === undefined ? null : Number(value),
};
