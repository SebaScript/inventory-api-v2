import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiCommonErrors,
  ApiPaginatedResponse,
} from '../../common/decorators/api-responses.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { QueryGroupsDto } from './dto/query-groups.dto';
import { ReplaceGroupDto, UpdateGroupDto } from './dto/update-group.dto';
import { Group } from './entities/group.entity';
import { GroupsService } from './groups.service';

/**
 * HTTP layer for groups: it validates, delegates and shapes the response.
 * All business rules live in `GroupsService`.
 */
@ApiTags('Groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a group',
    description: 'Group names are unique case-insensitively: "Tools" and "tools" collide.',
  })
  @ApiResponse({ status: 201, description: 'Group created', type: Group })
  @ApiCommonErrors(409)
  create(@Body() dto: CreateGroupDto): Promise<Group> {
    return this.groupsService.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List groups',
    description:
      'Paginated, searchable and sortable. `pageSize` is capped at 100, so an ' +
      'unbounded result set can never be requested.',
  })
  @ApiPaginatedResponse(Group, 'Paginated list of groups')
  @ApiCommonErrors()
  findAll(@Query() query: QueryGroupsDto): Promise<PaginatedResponseDto<Group>> {
    return this.groupsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a group by id' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'The requested group', type: Group })
  @ApiCommonErrors(404)
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Group> {
    return this.groupsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Replace a group',
    description:
      'Full replacement. Fields omitted from the payload are reset, ' +
      'which is what makes PUT idempotent. Use PATCH for partial updates.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Group replaced', type: Group })
  @ApiCommonErrors(404, 409)
  replace(@Param('id', ParseIntPipe) id: number, @Body() dto: ReplaceGroupDto): Promise<Group> {
    return this.groupsService.replace(id, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Partially update a group',
    description: 'Only the supplied fields are modified.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Group updated', type: Group })
  @ApiCommonErrors(404, 409)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto): Promise<Group> {
    return this.groupsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a group',
    description:
      'Rejected with 409 while the group still contains items, so inventory ' +
      'is never destroyed as a side effect of deleting a category.',
  })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 204, description: 'Group deleted' })
  @ApiCommonErrors(404, 409)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.groupsService.remove(id);
  }
}
