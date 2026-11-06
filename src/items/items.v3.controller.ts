import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ItemsControllerBase } from './items.controller';
import { ItemsService } from './items.service';

/** `/v3/items`: the same routes as v1 and v2. */
@ApiTags('Items v3')
@Controller({ path: 'items', version: '3' })
export class ItemsV3Controller extends ItemsControllerBase {
  // Required: without it Nest injects `undefined` instead of failing.
  constructor(service: ItemsService) {
    super(service);
  }
}
