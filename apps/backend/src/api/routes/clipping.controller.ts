import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { LocalClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/local.clipping.service';
import {
  ClippingDto,
  DraftClippingDto,
  LocalClippingDto,
  ReviewClippingDto,
} from '@gitroom/nestjs-libraries/dtos/clipping/clipping.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Clipping')
@Controller('/clipping')
export class ClippingController {
  constructor(
    private _clippingService: ClippingService,
    private localClipping: LocalClippingService
  ) {}

  @Get('/local')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  listLocal(@GetOrgFromRequest() org: Organization) {
    return this.localClipping.list(org.id);
  }

  @Post('/local')
  startLocal(
    @GetOrgFromRequest() org: Organization,
    @Body() body: LocalClippingDto
  ) {
    return this.localClipping.start(org.id, body);
  }

  @Get('/local/:id')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  getLocal(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this.localClipping.get(org.id, id);
  }

  @Post('/local/:id/clips/:clipId/review')
  reviewLocal(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('clipId') clipId: string,
    @Body() body: ReviewClippingDto
  ) {
    return this.localClipping.review(org.id, id, clipId, body.decision);
  }

  @Post('/local/:id/clips/:clipId/draft')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  draftLocal(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('clipId') clipId: string,
    @Body() body: DraftClippingDto
  ) {
    return this.localClipping.draft(org.id, id, clipId, body.integrationId);
  }

  @Post('/')
  startClipping(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ClippingDto
  ) {
    return this._clippingService.startClipping(org, body);
  }

  @Get('/')
  getClippings(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number
  ) {
    return this._clippingService.getClippings(org.id, page);
  }

  @Get('/:id')
  getClipping(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._clippingService.getClipping(org.id, id);
  }
}
