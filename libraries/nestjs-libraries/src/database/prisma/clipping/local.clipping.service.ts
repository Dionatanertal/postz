import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TemporalService } from 'nestjs-temporal-core';
import { escape } from 'lodash';
import { ClippingRepository } from './clipping.repository';
import { MediaService } from '../media/media.service';
import { IntegrationService } from '../integrations/integration.service';
import { PostsService } from '../posts/posts.service';
import {
  LocalClippingDto,
  ReviewClippingDto,
} from '@gitroom/nestjs-libraries/dtos/clipping/clipping.dto';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';
import {
  localClippingEnabled,
  LocalClippingProcessor,
} from '@gitroom/nestjs-libraries/upload/local.clipping.processor';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

const localClipPostId = (clipId: string) => `local_clip_draft_${clipId}`;

@Injectable()
export class LocalClippingService {
  private logger = new Logger(LocalClippingService.name);

  constructor(
    private repository: ClippingRepository,
    private media: MediaService,
    private integrations: IntegrationService,
    private posts: PostsService,
    private temporal: TemporalService
  ) {}

  async list(org: string) {
    if (!localClippingEnabled()) {
      return { enabled: false, jobs: [] };
    }
    await this.failStale(org);
    return {
      enabled: true,
      jobs: await this.repository.listLocalClippings(org),
    };
  }

  async get(org: string, id: string) {
    await this.failStale(org);
    const job = await this.repository.getLocalClipping(org, id);
    if (!job) {
      throw new NotFoundException('Clipping not found.');
    }
    const ids = job.clips
      .filter((clip) => clip.draftedAt)
      .map((clip) => localClipPostId(clip.id));
    const posts = ids.length
      ? await this.posts.getLocalClipPosts(org, ids)
      : [];
    const byId = new Map(posts.map((post) => [post.id, post]));
    return {
      ...job,
      clips: job.clips.map((clip) => ({
        ...clip,
        post: byId.get(localClipPostId(clip.id)) ?? null,
      })),
    };
  }

  private failStale(org: string) {
    return this.repository.failStaleLocalClippings(
      org,
      new Date(Date.now() - 45 * 60_000)
    );
  }

  async start(org: string, body: LocalClippingDto) {
    if (!localClippingEnabled()) {
      throw new ServiceUnavailableException(
        'Local clipping is not configured.'
      );
    }
    const client = this.temporal.client.getRawClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'Local clipping worker is unavailable.'
      );
    }
    const media = await this.media.getMediaStatus(org, body.mediaId);
    if (
      !media?.path ||
      media.status !== 'ready' ||
      !media.name.toLowerCase().endsWith('.mp4')
    ) {
      throw new BadRequestException('Upload an MP4 to start clipping.');
    }
    try {
      new LocalStorage(process.env.UPLOAD_DIRECTORY!).pathForUploadUrl(
        media.path
      );
    } catch {
      throw new BadRequestException(
        'The source must be stored in the local media library.'
      );
    }

    return this.withLock(`localClippingStart:${org}`, async () => {
      await this.failStale(org);
      if (await this.repository.getActiveLocalClipping(org)) {
        throw new ConflictException('Wait for the current video to finish.');
      }
      const job = await this.repository.createLocalClipping(
        org,
        media.path,
        media.originalName || media.name,
        body.startSeconds
      );
      try {
        await client.workflow.start('localClippingWorkflowV1', {
          workflowId: `local_clipping_${job.id}`,
          taskQueue: 'main',
          args: [{ clippingId: job.id, language: body.language }],
          workflowExecutionTimeout: '40 minutes',
        });
      } catch {
        await this.fail(job.id, 'Could not start the local clipping worker.');
        throw new ServiceUnavailableException(
          'Could not start the local clipping worker. Try again later.'
        );
      }
      return job;
    });
  }

  private async withLock<T>(key: string, work: () => Promise<T>) {
    const token = randomUUID();
    if (!(await ioRedis.set(key, token, 'EX', 60, 'NX'))) {
      throw new ConflictException('This action is already in progress.');
    }
    try {
      return await work();
    } finally {
      await ioRedis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
          1,
          key,
          token
        )
        .catch(() => this.logger.warn('Could not release local clipping lock'));
    }
  }

  async process(id: string, language: string, signal?: AbortSignal) {
    const job = await this.repository.getLocalClippingSource(id);
    if (!job || job.status === 'completed' || job.status === 'failed') {
      return;
    }
    if (!localClippingEnabled()) {
      await this.fail(
        id,
        'The worker is missing its local clipping configuration.'
      );
      return;
    }
    const storage = new LocalStorage(process.env.UPLOAD_DIRECTORY!);
    const scratchRoot = process.env.LOCAL_CLIPPING_TMP_DIR || tmpdir();
    const stagedPaths: string[] = [];
    let directory: string | undefined;
    let committed = false;
    try {
      // An excerpt, its transcription and the rendered MP4s all coexist here.
      // Refuse work if the scratch filesystem is already critically full.
      const { bavail, bsize } = await statfs(scratchRoot);
      if (bavail * bsize < 2 * 1024 * 1024 * 1024) {
        await this.fail(
          id,
          'Local clipping needs at least 2 GiB of free scratch space. Choose a different temporary volume.'
        );
        return;
      }
      directory = await mkdtemp(join(scratchRoot, 'postiz-clipping-'));
      const processor = new LocalClippingProcessor(directory, signal);
      const start = job.localStartSeconds!;
      const duration = await processor.prepare(
        storage.pathForUploadUrl(job.url),
        start
      );
      if (!duration) {
        await this.fail(
          id,
          'The video must contain audio and at least 20 seconds after the chosen start.'
        );
        return;
      }
      if (
        !(await this.repository.updateLocalClipping(id, {
          status: 'transcribing',
          duration,
        }))
      ) {
        return;
      }
      await processor.transcribe(language);
      if (
        !(await this.repository.updateLocalClipping(id, { status: 'picking' }))
      ) {
        return;
      }
      if (!(await processor.select(job.title || '', language))) {
        await this.fail(id, 'The local model did not find a complete passage.');
        return;
      }
      if (
        !(await this.repository.updateLocalClipping(id, {
          status: 'rendering',
        }))
      ) {
        return;
      }
      const rendered = await processor.render();
      // Render files live in scratch storage; uploading them must not exhaust
      // the persistent media volume, which also holds the user's originals.
      const mediaStats = await statfs(process.env.UPLOAD_DIRECTORY!);
      const renderedSizes = await Promise.all(
        rendered.map(async (clip) => (await stat(clip.file)).size)
      );
      const neededBytes =
        renderedSizes.reduce((total, size) => total + size, 0) +
        1024 * 1024 * 1024;
      if (mediaStats.bavail * mediaStats.bsize < neededBytes) {
        await this.fail(
          id,
          'Not enough free media storage to save these clips and preserve 1 GiB of free space.'
        );
        return;
      }
      const clips: Parameters<ClippingRepository['finishLocalClipping']>[1] =
        [];
      for (const { file, ...clip } of rendered) {
        const uploaded = await storage.uploadStream(
          createReadStream(file),
          'video/mp4',
          'mp4'
        );
        stagedPaths.push(uploaded.path);
        clips.push({
          ...clip,
          start: clip.start + start,
          end: clip.end + start,
          path: uploaded.path,
        });
      }
      committed = await this.repository.finishLocalClipping(id, clips);
    } catch {
      this.logger.warn(
        `Local clipping command or persistence failed for ${id}`
      );
      await this.fail(
        id,
        'Local processing failed. Check the worker tools or try a different excerpt.'
      );
    } finally {
      if (!committed && stagedPaths.length) {
        // A failed/retried worker can upload files without committing them.
        // Only delete files proven unreferenced: the DB transaction might
        // have succeeded even if the response was lost.
        const current = await this.repository
          .getLocalClipping(job.organizationId, id)
          .catch(() => null);
        if (current) {
          const referenced = new Set(current.clips.map((clip) => clip.path));
          await Promise.all(
            stagedPaths
              .filter((path) => !referenced.has(path))
              .map((path) => storage.removeFile(path).catch(() => {}))
          );
        }
      }
      if (directory) {
        await rm(directory, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async fail(id: string, error: string) {
    await this.repository.updateLocalClipping(id, { status: 'failed', error });
  }

  async review(
    org: string,
    clippingId: string,
    clipId: string,
    decision: ReviewClippingDto['decision']
  ) {
    const clip = await this.findClip(org, clippingId, clipId);
    if (clip.reviewState === decision) {
      return { decision };
    }
    const { count } = await this.repository.reviewLocalClip(
      org,
      clippingId,
      clipId,
      decision
    );
    if (!count) {
      throw new ConflictException(
        'A clip sent to the draft flow cannot be reviewed again.'
      );
    }
    return { decision };
  }

  private async findClip(org: string, clippingId: string, clipId: string) {
    const job = await this.repository.getLocalClipping(org, clippingId);
    const clip = job?.clips.find((item) => item.id === clipId);
    if (!clip?.path || job?.status !== 'completed') {
      throw new NotFoundException('Clip not found.');
    }
    return clip;
  }

  draft(
    org: string,
    clippingId: string,
    clipId: string,
    integrationId: string
  ) {
    return this.withLock(`localClippingDraft:${org}:${clipId}`, () =>
      this.createDraft(org, clippingId, clipId, integrationId)
    );
  }

  private async createDraft(
    org: string,
    clippingId: string,
    clipId: string,
    integrationId: string
  ) {
    const clip = await this.findClip(org, clippingId, clipId);
    if (clip.reviewState !== 'approved') {
      throw new ConflictException('Approve the clip before creating a draft.');
    }
    const postId = localClipPostId(clipId);
    if (clip.draftIntegrationId && clip.draftIntegrationId !== integrationId) {
      throw new ConflictException(
        'Continue this draft with its original channel.'
      );
    }
    const existing = await this.posts.findLocalClipDraft(org, postId);
    if (existing?.deletedAt) {
      throw new ConflictException(
        'The linked post was deleted. It cannot be recreated automatically.'
      );
    }
    if (clip.draftedAt) {
      if (!existing) {
        throw new ConflictException('The linked post is no longer available.');
      }
      return { postId };
    }
    if (existing) {
      if (existing.integrationId !== integrationId) {
        throw new ConflictException(
          'Continue this draft with its original channel.'
        );
      }
      if (!clip.draftIntegrationId) {
        const { count } = await this.repository.reserveLocalClipDraft(
          org,
          clippingId,
          clipId,
          integrationId
        );
        if (!count) {
          throw new ConflictException(
            'The clip changed. Reload it and try again.'
          );
        }
      }
      await this.repository.markLocalClipDrafted(
        org,
        clippingId,
        clipId,
        integrationId
      );
      return { postId };
    }
    const channel = await this.integrations.getIntegrationById(
      org,
      integrationId
    );
    if (
      !channel ||
      channel.deletedAt ||
      channel.disabled ||
      channel.inBetweenSteps
    ) {
      if (clip.draftIntegrationId) {
        await this.repository.releaseLocalClipDraft(
          org,
          clippingId,
          clipId,
          integrationId
        );
      }
      throw new BadRequestException('Choose an available channel.');
    }

    if (!clip.draftIntegrationId) {
      const { count } = await this.repository.reserveLocalClipDraft(
        org,
        clippingId,
        clipId,
        integrationId
      );
      if (!count) {
        throw new ConflictException(
          'The clip changed. Reload it and try again.'
        );
      }
    }
    if (!(await this.posts.findLocalClipDraft(org, postId))) {
      try {
        const time = await this.posts.findFreeDateTime(org, integrationId);
        await this.posts.createPost(
          org,
          {
            type: 'draft',
            date: time + 'Z',
            order: makeId(10),
            shortLink: false,
            tags: [],
            posts: [
              {
                settings: { __type: channel.providerIdentifier as any },
                group: makeId(10),
                integration: { id: integrationId },
                value: [
                  {
                    id: postId,
                    content: escape(clip.content),
                    delay: 0,
                    image: [{ id: clipId, path: clip.path! }],
                  },
                ],
              },
            ],
          },
          'WEB',
          false,
          true
        );
      } catch {
        // The post may already have committed before a transport failure or concurrent retry.
      }
    }
    const draft = await this.posts.findLocalClipDraft(org, postId);
    if (draft?.integrationId !== integrationId) {
      if (!draft) {
        await this.repository.releaseLocalClipDraft(
          org,
          clippingId,
          clipId,
          integrationId
        );
      }
      throw new ServiceUnavailableException(
        'Could not save the draft. Try again.'
      );
    }
    await this.repository.markLocalClipDrafted(
      org,
      clippingId,
      clipId,
      integrationId
    );
    return { postId };
  }
}
