import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MovementType } from '../entities/movement.entity';
import { CreateMovementDto } from './create-movement.dto';

const validate = (plain: Record<string, unknown>): { dto: CreateMovementDto; errors: string[] } => {
  const dto = plainToInstance(CreateMovementDto, plain, { enableImplicitConversion: false });
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).flatMap(
    (error) => Object.values(error.constraints ?? {}),
  );
  return { dto, errors };
};

describe('CreateMovementDto', () => {
  it('accepts a well-formed IN movement', () => {
    const { errors } = validate({
      itemId: 1,
      type: MovementType.IN,
      quantity: 25,
      reason: 'Supplier delivery',
    });
    expect(errors).toEqual([]);
  });

  it('accepts a movement without a reason', () => {
    const { errors } = validate({ itemId: 1, type: MovementType.OUT, quantity: 5 });
    expect(errors).toEqual([]);
  });

  it('trims a padded reason', () => {
    const { dto } = validate({
      itemId: 1,
      type: MovementType.IN,
      quantity: 1,
      reason: '  Delivery  ',
    });
    expect(dto.reason).toBe('Delivery');
  });

  describe('quantity', () => {
    it.each([0, -1, -100])('rejects %i, since direction is carried by `type`', (quantity) => {
      const { errors } = validate({ itemId: 1, type: MovementType.IN, quantity });
      expect(errors.join(' ')).toContain('quantity must be greater than 0');
    });

    it('rejects a fractional quantity', () => {
      const { errors } = validate({ itemId: 1, type: MovementType.IN, quantity: 2.5 });
      expect(errors.join(' ')).toContain('quantity must be an integer');
    });

    it('rejects a missing quantity', () => {
      const { errors } = validate({ itemId: 1, type: MovementType.IN });
      expect(errors.join(' ')).toContain('quantity');
    });
  });

  describe('type', () => {
    it.each(['in', 'out', 'ADJUST', '', null])('rejects %p', (type) => {
      const { errors } = validate({ itemId: 1, type, quantity: 1 });
      expect(errors.join(' ')).toContain('type must be one of: IN, OUT');
    });

    it.each([MovementType.IN, MovementType.OUT])('accepts %s', (type) => {
      const { errors } = validate({ itemId: 1, type, quantity: 1 });
      expect(errors).toEqual([]);
    });
  });

  describe('itemId', () => {
    it.each([0, -5, 1.5, 'abc'])('rejects %p', (itemId) => {
      const { errors } = validate({ itemId, type: MovementType.IN, quantity: 1 });
      expect(errors.join(' ')).toContain('itemId');
    });
  });

  it('rejects a reason longer than 255 characters', () => {
    const { errors } = validate({
      itemId: 1,
      type: MovementType.IN,
      quantity: 1,
      reason: 'x'.repeat(256),
    });
    expect(errors.join(' ')).toContain('reason');
  });

  it('rejects unknown properties, so a typo is a loud 400 not a silent no-op', () => {
    const { errors } = validate({
      itemId: 1,
      type: MovementType.IN,
      quantity: 1,
      resultingStock: 9999,
    });
    expect(errors.join(' ')).toContain('resultingStock');
  });
});
