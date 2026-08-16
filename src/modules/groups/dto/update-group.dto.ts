import { PartialType } from '@nestjs/swagger';
import { CreateGroupDto } from './create-group.dto';

/**
 * Body for `PATCH /groups/:id` — every field optional, only what is sent is
 * changed.
 */
export class UpdateGroupDto extends PartialType(CreateGroupDto) {}

/**
 * Body for `PUT /groups/:id`.
 *
 * PUT replaces the resource, so it carries the same required fields as
 * creation: omitting `description` clears it, rather than leaving the previous
 * value in place. That is the distinction from PATCH, and it is what makes PUT
 * genuinely idempotent.
 */
export class ReplaceGroupDto extends CreateGroupDto {}
