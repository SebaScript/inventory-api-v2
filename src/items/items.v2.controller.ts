import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ItemsControllerBase } from './items.controller';
import { ItemsService } from './items.service';

/**
 * `/v2/items`: same routes and same service as v1, ready to diverge. The QUERY
 * verb is mounted here too, so `QUERY /v2/items/search` works like its v1 twin.
 */
@ApiTags('Items v2')
@Controller({ path: 'items', version: '2' })
export class ItemsV2Controller extends ItemsControllerBase {
  constructor(service: ItemsService) {
    super(service);
  }
}
