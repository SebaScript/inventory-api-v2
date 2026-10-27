import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GroupsControllerBase } from './groups.controller';
import { GroupsService } from './groups.service';

/** `/v2/groups` and `/v3/groups`: same routes and same service as v1, ready to diverge. */
@ApiTags('Groups v2, v3')
@Controller({ path: 'groups', version: ['2', '3'] })
export class GroupsV2Controller extends GroupsControllerBase {
  constructor(service: GroupsService) {
    super(service);
  }
}
