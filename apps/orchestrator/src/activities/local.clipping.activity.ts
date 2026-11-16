import { Injectable } from '@nestjs/common';
import { Context } from '@temporalio/activity';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { LocalClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/local.clipping.service';

@Injectable()
@Activity()
export class LocalClippingActivity {
  constructor(private clipping: LocalClippingService) {}

  @ActivityMethod()
  processLocalClipping(clippingId: string, language: string) {
    const context = Context.current();
    const heartbeat = setInterval(() => context.heartbeat(), 5000);
    return this.clipping
      .process(clippingId, language, context.cancellationSignal)
      .finally(() => clearInterval(heartbeat));
  }

  @ActivityMethod()
  failLocalClipping(clippingId: string) {
    return this.clipping.fail(clippingId, 'Local clipping was interrupted.');
  }
}
