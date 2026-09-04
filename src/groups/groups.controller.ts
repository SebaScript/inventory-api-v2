import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Paginated } from '../common/pagination';
import { Group } from '../entities/group.entity';
import { CreateGroupDto, FindGroupsDto, UpdateGroupDto } from './group.dto';
import { GroupsService } from './groups.service';

/**
 * Every route of the resource, with no path and no version of its own. Each
 * version below mounts it, so a version only has to declare what it changes.
 */
export abstract class GroupsControllerBase {
  constructor(protected readonly service: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a group' })
  @ApiResponse({ status: 201, type: Group })
  @ApiResponse({ status: 409, description: 'Name already taken' })
  create(@Body() dto: CreateGroupDto): Promise<Group> {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List groups (paginated, searchable)' })
  findAll(@Query() query: FindGroupsDto): Promise<Paginated<Group>> {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one group' })
  @ApiResponse({ status: 200, type: Group })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Group> {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a group: only the fields sent change' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto): Promise<Group> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a group' })
  @ApiResponse({ status: 409, description: 'The group still has items' })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }
}

@ApiTags('Groups')
@Controller('groups')
export class GroupsController extends GroupsControllerBase {
  // Declared on purpose: without it TypeScript emits no `design:paramtypes`
  // for this class and Nest injects `undefined` instead of failing to start.
  constructor(service: GroupsService) {
    super(service);
  }
}
