/**
 * Machine-readable error codes returned in the `code` field of every error
 * response. Clients should branch on these rather than parsing messages.
 */
export enum DomainErrorCode {
  GROUP_NOT_FOUND = 'GROUP_NOT_FOUND',
  ITEM_NOT_FOUND = 'ITEM_NOT_FOUND',
  MOVEMENT_NOT_FOUND = 'MOVEMENT_NOT_FOUND',
  GROUP_NAME_ALREADY_EXISTS = 'GROUP_NAME_ALREADY_EXISTS',
  SKU_ALREADY_EXISTS = 'SKU_ALREADY_EXISTS',
  GROUP_NOT_EMPTY = 'GROUP_NOT_EMPTY',
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
}

/**
 * Base class for every business-rule violation.
 *
 * Services throw these — never `HttpException` — so the business layer stays
 * free of framework and transport concerns and can be unit tested without
 * NestJS. `DomainExceptionFilter` is the single place that maps a domain error
 * onto an HTTP status code.
 */
export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;

  /** Extra machine-readable context merged into the error response. */
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** A referenced resource does not exist. Maps to 404. */
export abstract class NotFoundDomainError extends DomainError {}

/** The request conflicts with the current state of the resource. Maps to 409. */
export abstract class ConflictDomainError extends DomainError {}

export class GroupNotFoundError extends NotFoundDomainError {
  readonly code = DomainErrorCode.GROUP_NOT_FOUND;

  constructor(groupId: number) {
    super(`Group with id ${groupId} was not found`, { groupId });
  }
}

export class ItemNotFoundError extends NotFoundDomainError {
  readonly code = DomainErrorCode.ITEM_NOT_FOUND;

  constructor(itemId: number) {
    super(`Item with id ${itemId} was not found`, { itemId });
  }
}

export class MovementNotFoundError extends NotFoundDomainError {
  readonly code = DomainErrorCode.MOVEMENT_NOT_FOUND;

  constructor(movementId: number) {
    super(`Movement with id ${movementId} was not found`, { movementId });
  }
}

export class GroupNameAlreadyExistsError extends ConflictDomainError {
  readonly code = DomainErrorCode.GROUP_NAME_ALREADY_EXISTS;

  constructor(name: string) {
    super(`A group named "${name}" already exists (names are case-insensitive)`, { name });
  }
}

export class SkuAlreadyExistsError extends ConflictDomainError {
  readonly code = DomainErrorCode.SKU_ALREADY_EXISTS;

  constructor(sku: string) {
    super(`An item with SKU "${sku}" already exists`, { sku });
  }
}

export class GroupNotEmptyError extends ConflictDomainError {
  readonly code = DomainErrorCode.GROUP_NOT_EMPTY;

  constructor(groupId: number) {
    super(
      `Group ${groupId} still contains items and cannot be deleted. ` +
        `Move or delete its items first.`,
      { groupId },
    );
  }
}

/**
 * Raised when an OUT movement would drive stock below zero.
 *
 * Carries the numbers the client needs to recover (what is available versus
 * what was requested) instead of a bare "not enough stock".
 */
export class InsufficientStockError extends ConflictDomainError {
  readonly code = DomainErrorCode.INSUFFICIENT_STOCK;

  constructor(
    readonly itemId: number,
    readonly available: number,
    readonly requested: number,
  ) {
    super(
      `Insufficient stock for item ${itemId}: ${available} unit(s) available, ` +
        `${requested} requested`,
      { itemId, available, requested },
    );
  }
}
