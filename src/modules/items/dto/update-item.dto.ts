import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateItemDto } from './create-item.dto';

/**
 * Fields an item update may touch.
 *
 * `quantity` is deliberately excluded: stock is a derived value owned by the
 * movements ledger. Sending it returns 400 (`forbidNonWhitelisted`), which
 * points the caller at `POST /movements` instead of letting them silently
 * desynchronise stock from its history.
 */
export class ReplaceItemDto extends OmitType(CreateItemDto, ['quantity'] as const) {}

/** Body for `PATCH /items/:id` — every field optional. */
export class UpdateItemDto extends PartialType(ReplaceItemDto) {}
