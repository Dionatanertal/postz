import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClippingRepository {
  constructor(
    private _clipping: PrismaRepository<'clipping'>,
    private _clippingClip: PrismaRepository<'clippingClip'>,
    private _transaction: PrismaTransaction
  ) {}

  createClipping(
    org: string,
    url: string,
    maxClips: number,
    fit: 'crop' | 'blur',
    integrations: string[]
  ) {
    return this._clipping.model.clipping.create({
      data: {
        organizationId: org,
        url,
        maxClips,
        fit,
        integrations: JSON.stringify(integrations),
      },
      select: {
        id: true,
        status: true,
      },
    });
  }

  getRunningClippings(org: string) {
    return this._clipping.model.clipping.findMany({
      where: {
        organizationId: org,
        localStartSeconds: null,
        deletedAt: null,
        status: {
          notIn: ['completed', 'failed'],
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });
  }

  countClippingsSince(org: string, since: Date) {
    return this._clipping.model.clipping.count({
      where: {
        organizationId: org,
        localStartSeconds: null,
        createdAt: {
          gte: since,
        },
      },
    });
  }

  getClippingById(id: string) {
    return this._clipping.model.clipping.findFirst({
      where: {
        id,
        localStartSeconds: null,
        deletedAt: null,
      },
      include: {
        clips: {
          orderBy: {
            start: 'asc',
          },
        },
      },
    });
  }

  getClipping(org: string, id: string) {
    return this._clipping.model.clipping.findFirst({
      where: {
        id,
        organizationId: org,
        localStartSeconds: null,
        deletedAt: null,
      },
      select: {
        id: true,
        url: true,
        status: true,
        error: true,
        title: true,
        thumbnail: true,
        duration: true,
        createdAt: true,
        clips: {
          orderBy: {
            start: 'asc',
          },
          select: {
            id: true,
            title: true,
            content: true,
            start: true,
            end: true,
            status: true,
            error: true,
            mediaId: true,
            path: true,
            thumbnail: true,
          },
        },
      },
    });
  }

  // Only what the widget shows and reports: the ticket travels in a query
  // string, so the route gives away as little as it can
  getClippingProgress(org: string, id: string) {
    return this._clipping.model.clipping.findFirst({
      where: {
        id,
        organizationId: org,
        localStartSeconds: null,
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        error: true,
        title: true,
        clips: {
          orderBy: {
            start: 'asc',
          },
          select: {
            id: true,
            title: true,
            status: true,
            error: true,
            mediaId: true,
            path: true,
            thumbnail: true,
          },
        },
      },
    });
  }

  async getClippings(org: string, page: number) {
    const pageNum = Math.max(+page || 1, 1) - 1;
    const where = {
      organizationId: org,
      localStartSeconds: null,
      deletedAt: null as null,
    };

    const pages = Math.ceil(
      (await this._clipping.model.clipping.count({ where })) / 20
    );

    const results = await this._clipping.model.clipping.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        url: true,
        status: true,
        error: true,
        title: true,
        thumbnail: true,
        duration: true,
        createdAt: true,
      },
      skip: pageNum * 20,
      take: 20,
    });

    return {
      pages,
      results,
    };
  }

  updateClipping(
    org: string,
    id: string,
    data: {
      status?: string;
      error?: string | null;
      title?: string;
      thumbnail?: string;
      duration?: number;
      creditsId?: string | null;
    }
  ) {
    return this._clipping.model.clipping.update({
      where: {
        id,
        organizationId: org,
      },
      data,
      select: {
        id: true,
        status: true,
      },
    });
  }

  // An attempt that timed out can still be running when its retry gets here, and
  // only one may store clips. The look at what is there is not enough on its own
  // (both can see nothing), so the update takes the row of the clipping first:
  // the second attempt waits on it until the first commits and then finds its clips
  createClips(
    clippingId: string,
    clips: { title: string; content: string; start: number; end: number }[]
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      await tx.clipping.update({
        where: { id: clippingId },
        data: { updatedAt: new Date() },
        select: { id: true },
      });

      const select = { where: { clippingId }, select: { id: true } };
      const existing = await tx.clippingClip.findMany(select);
      if (existing.length) {
        return existing;
      }

      await tx.clippingClip.createMany({
        data: clips.map((clip) => ({
          clippingId,
          ...clip,
        })),
      });

      return tx.clippingClip.findMany(select);
    });
  }

  failUnfinishedClips(clippingId: string, error: string) {
    return this._clippingClip.model.clippingClip.updateMany({
      where: {
        clippingId,
        status: 'pending',
      },
      data: {
        status: 'failed',
        error,
      },
    });
  }

  // Only the attempt that moves draftedAt off null may create the draft
  async claimClipDraft(id: string) {
    const { count } = await this._clippingClip.model.clippingClip.updateMany({
      where: {
        id,
        draftedAt: null,
      },
      data: {
        draftedAt: new Date(),
      },
    });

    return count === 1;
  }

  getClipById(id: string) {
    return this._clippingClip.model.clippingClip.findUnique({
      where: {
        id,
      },
      include: {
        clipping: true,
      },
    });
  }

  updateClip(
    id: string,
    data: {
      status?: string;
      error?: string | null;
      trimStart?: number;
      mediaId?: string;
      path?: string;
      thumbnail?: string;
      draftedAt?: Date;
    }
  ) {
    return this._clippingClip.model.clippingClip.update({
      where: {
        id,
      },
      data,
      select: {
        id: true,
        status: true,
      },
    });
  }

  createLocalClipping(org: string, url: string, title: string, startSeconds: number) {
    return this._clipping.model.clipping.create({
      data: {
        organizationId: org,
        url,
        title,
        localStartSeconds: startSeconds,
        status: 'analysing',
        maxClips: 3,
        integrations: '[]',
      },
      select: { id: true },
    });
  }

  async failStaleLocalClippings(org: string, updatedBefore: Date) {
    await this._clipping.model.clipping.updateMany({
      where: {
        organizationId: org,
        localStartSeconds: { not: null },
        status: { notIn: ['completed', 'failed'] },
        updatedAt: { lt: updatedBefore },
        deletedAt: null,
      },
      data: { status: 'failed', error: 'Local clipping timed out.' },
    });
  }

  getActiveLocalClipping(org: string) {
    return this._clipping.model.clipping.findFirst({
      where: {
        organizationId: org,
        localStartSeconds: { not: null },
        status: { notIn: ['completed', 'failed'] },
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  listLocalClippings(org: string) {
    return this._clipping.model.clipping.findMany({
      where: { organizationId: org, localStartSeconds: { not: null }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, status: true },
    });
  }

  getLocalClipping(org: string, id: string) {
    return this._clipping.model.clipping.findFirst({
      where: { id, organizationId: org, localStartSeconds: { not: null }, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        error: true,
        clips: {
          orderBy: { start: 'asc' },
          select: {
            id: true,
            title: true,
            content: true,
            start: true,
            end: true,
            path: true,
            reviewState: true,
            draftIntegrationId: true,
            draftedAt: true,
          },
        },
      },
    });
  }

  getLocalClippingSource(id: string) {
    return this._clipping.model.clipping.findFirst({
      where: { id, localStartSeconds: { not: null }, deletedAt: null },
      select: { organizationId: true, url: true, title: true, localStartSeconds: true, status: true },
    });
  }

  async updateLocalClipping(
    id: string,
    data: { status: string; duration?: number; error?: string }
  ) {
    const { count } = await this._clipping.model.clipping.updateMany({
      where: {
        id,
        localStartSeconds: { not: null },
        status: { notIn: ['completed', 'failed'] },
        deletedAt: null,
      },
      data,
    });
    return count === 1;
  }

  finishLocalClipping(
    id: string,
    clips: { title: string; content: string; start: number; end: number; path: string }[]
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      const { count } = await tx.clipping.updateMany({
        where: { id, status: 'rendering', localStartSeconds: { not: null }, deletedAt: null },
        data: { status: 'completed' },
      });
      if (count !== 1) {
        return false;
      }
      await tx.clippingClip.createMany({
        data: clips.map((clip) => ({
          ...clip,
          clippingId: id,
          status: 'completed',
          reviewState: 'pending',
        })),
      });
      return true;
    });
  }

  private localClipWhere(org: string, clippingId: string, id: string) {
    return {
      id,
      clippingId,
      status: 'completed',
      clipping: { organizationId: org, localStartSeconds: { not: null }, deletedAt: null },
    };
  }

  reviewLocalClip(org: string, clippingId: string, id: string, decision: 'approved' | 'rejected') {
    return this._clippingClip.model.clippingClip.updateMany({
      where: {
        ...this.localClipWhere(org, clippingId, id),
        draftIntegrationId: null,
        draftedAt: null,
      },
      data: { reviewState: decision },
    });
  }

  reserveLocalClipDraft(org: string, clippingId: string, id: string, integrationId: string) {
    return this._clippingClip.model.clippingClip.updateMany({
      where: {
        ...this.localClipWhere(org, clippingId, id),
        reviewState: 'approved',
        draftIntegrationId: null,
        draftedAt: null,
      },
      data: { draftIntegrationId: integrationId },
    });
  }

  markLocalClipDrafted(org: string, clippingId: string, id: string, integrationId: string) {
    return this._clippingClip.model.clippingClip.updateMany({
      where: {
        ...this.localClipWhere(org, clippingId, id),
        draftIntegrationId: integrationId,
        draftedAt: null,
      },
      data: { draftedAt: new Date() },
    });
  }

  releaseLocalClipDraft(org: string, clippingId: string, id: string, integrationId: string) {
    return this._clippingClip.model.clippingClip.updateMany({
      where: {
        ...this.localClipWhere(org, clippingId, id),
        draftIntegrationId: integrationId,
        draftedAt: null,
      },
      data: { draftIntegrationId: null },
    });
  }
}
