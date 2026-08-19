import { ConflictException, NotFoundException } from '@nestjs/common';

export class GroupNotFoundException extends NotFoundException {
  constructor(id: number) {
    super({ code: 'GROUP_NOT_FOUND', message: `Group ${id} was not found` });
  }
}

export class ItemNotFoundException extends NotFoundException {
  constructor(id: number) {
    super({ code: 'ITEM_NOT_FOUND', message: `Item ${id} was not found` });
  }
}

export class MovementNotFoundException extends NotFoundException {
  constructor(id: number) {
    super({ code: 'MOVEMENT_NOT_FOUND', message: `Movement ${id} was not found` });
  }
}

export class DuplicateNameException extends ConflictException {
  constructor(name: string) {
    super({
      code: 'GROUP_NAME_TAKEN',
      message: `A group named "${name}" already exists (names are case-insensitive)`,
    });
  }
}

export class DuplicateSkuException extends ConflictException {
  constructor(sku: string) {
    super({ code: 'SKU_TAKEN', message: `An item with SKU "${sku}" already exists` });
  }
}

export class ItemDiscontinuedException extends ConflictException {
  constructor(id: number) {
    super({
      code: 'ITEM_DISCONTINUED',
      message: `Item ${id} is discontinued and cannot receive movements`,
    });
  }
}

export class GroupNotEmptyException extends ConflictException {
  constructor(id: number) {
    super({
      code: 'GROUP_NOT_EMPTY',
      message: `Group ${id} still has items. Move or delete them before deleting the group.`,
    });
  }
}

export class InsufficientStockException extends ConflictException {
  constructor(itemId: number, available: number, requested: number) {
    super({
      code: 'INSUFFICIENT_STOCK',
      message: `Item ${itemId} has ${available} unit(s) available, ${requested} requested`,
      available,
      requested,
    });
  }
}
