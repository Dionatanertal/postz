'use client';

import { FormEvent, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { MediaBox } from '@gitroom/frontend/components/media/media.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LocalClippingResults } from '@gitroom/frontend/components/media/local.clipping.results.component';

type JobSummary = { id: string; title: string; status: string };
type Clip = {
  id: string;
  title: string;
  content: string;
  start: number;
  end: number;
  path: string;
  reviewState: 'pending' | 'approved' | 'rejected';
  draftIntegrationId: string | null;
  draftedAt: string | null;
  post: { id: string; state: 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR' } | null;
};
type Job = JobSummary & { error: string | null; clips: Clip[] };
type Channel = {
  id: string;
  name: string;
  disabled: boolean;
  inBetweenSteps: boolean;
};

const endpoint = '/clipping/local';
const fieldClass =
  'min-h-10 rounded border border-newBorder bg-newBgColor px-3 py-2';
const labels: Record<string, string> = {
  analysing: 'Preparando vídeo',
  transcribing: 'Transcrevendo com Whisper',
  picking: 'Selecionando trechos',
  rendering: 'Gerando cortes e legendas',
  completed: 'Pronto para revisão',
  failed: 'Falha no processamento',
  pending: 'Aguardando revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  DRAFT: 'Rascunho',
  QUEUE: 'Agendado',
  PUBLISHED: 'Publicado',
  ERROR: 'Falha na publicação',
};

const active = (job: JobSummary) =>
  !['completed', 'failed'].includes(job.status);

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : 'Não foi possível concluir a ação.'
    );
  }
  if (body === null) {
    throw new Error('O servidor retornou uma resposta inválida.');
  }
  return body;
}

export function useLocalClippingJobs() {
  const request = useFetch();
  return useSWR(
    endpoint,
    async (url: string) =>
      readResponse<{ enabled: boolean; jobs: JobSummary[] }>(
        await request(url)
      ),
    { refreshInterval: (data) => (data?.jobs.some(active) ? 4000 : 0) }
  );
}

function useLocalClippingJob(id?: string) {
  const request = useFetch();
  return useSWR(
    id ? `${endpoint}/${id}` : null,
    async (url: string) => readResponse<Job>(await request(url)),
    { refreshInterval: (data) => (data && active(data) ? 2000 : 0) }
  );
}

function formatTime(seconds: number) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  return [hours, minutes, whole % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

function ClipReview({
  jobId,
  clip,
  channels,
  refresh,
}: {
  jobId: string;
  clip: Clip;
  channels: Channel[];
  refresh: () => Promise<unknown>;
}) {
  const fetch = useFetch();
  const [channel, setChannel] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const destination = clip.draftIntegrationId || channel;

  async function act(action: 'approved' | 'rejected' | 'draft') {
    setPending(action);
    setError('');
    try {
      const path = action === 'draft' ? 'draft' : 'review';
      await readResponse(
        await fetch(`${endpoint}/${jobId}/clips/${clip.id}/${path}`, {
          method: 'POST',
          body: JSON.stringify(
            action === 'draft'
              ? { integrationId: destination }
              : { decision: action }
          ),
        })
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível concluir a ação.'
      );
      await refresh();
    } finally {
      setPending('');
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded border border-newBorder bg-newBgColorInner p-4">
      <div>
        <h3 className="font-semibold">{clip.title}</h3>
        <p className="text-sm opacity-80">
          {formatTime(clip.start)}–{formatTime(clip.end)} ·{' '}
          {labels[clip.reviewState]}
        </p>
      </div>
      <video
        aria-label={clip.title}
        className="mx-auto max-h-[440px] w-full rounded bg-black"
        controls
        playsInline
        preload="metadata"
        src={clip.path}
      />
      {clip.content && <p className="text-sm">{clip.content}</p>}
      {clip.draftedAt ? (
        clip.post ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{labels[clip.post.state]}</span>
              <a
                className="underline"
                href={`/launches?postId=${encodeURIComponent(clip.post.id)}`}
              >
                {clip.post.state === 'PUBLISHED'
                  ? 'Ver resultados no calendário'
                  : 'Abrir post no calendário'}
              </a>
            </div>
            {clip.post.state === 'PUBLISHED' && (
              <LocalClippingResults key={clip.post.id} postId={clip.post.id} />
            )}
          </div>
        ) : (
          <p className="text-sm">O post vinculado está indisponível.</p>
        )
      ) : (
        <>
          {!clip.draftIntegrationId && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!!pending || clip.reviewState === 'approved'}
                loading={pending === 'approved'}
                onClick={() => act('approved')}
              >
                Aprovar
              </Button>
              <Button
                secondary
                disabled={!!pending || clip.reviewState === 'rejected'}
                loading={pending === 'rejected'}
                onClick={() => act('rejected')}
              >
                Rejeitar
              </Button>
            </div>
          )}
          {clip.reviewState === 'approved' &&
            (channels.length || clip.draftIntegrationId ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1">
                  Canal do rascunho
                  <select
                    className={fieldClass}
                    value={destination}
                    onChange={(event) => setChannel(event.target.value)}
                    disabled={!!pending || !!clip.draftIntegrationId}
                  >
                    <option value="">Selecione um canal</option>
                    {channels.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                    {clip.draftIntegrationId &&
                      !channels.some(
                        (item) => item.id === clip.draftIntegrationId
                      ) && (
                        <option value={clip.draftIntegrationId}>
                          Canal original indisponível
                        </option>
                      )}
                  </select>
                </label>
                <Button
                  disabled={!destination || !!pending}
                  loading={pending === 'draft'}
                  onClick={() => act('draft')}
                >
                  Criar rascunho
                </Button>
              </div>
            ) : (
              <p className="text-sm">Conecte um canal para criar o rascunho.</p>
            ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </article>
  );
}

export function LocalClipping({
  jobs,
  reload,
}: {
  jobs: JobSummary[];
  reload: () => Promise<unknown>;
}) {
  const fetch = useFetch();
  const modals = useModals();
  const { data: channelData } = useIntegrationList();
  const channels = ((channelData || []) as Channel[]).filter(
    (item) => !item.disabled && !item.inBetweenSteps
  );
  const [selectedId, setSelectedId] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [libraryVideo, setLibraryVideo] = useState<{
    id: string;
    originalName?: string;
  }>();
  const currentId = selectedId || jobs[0]?.id;
  const {
    data: result,
    error: jobError,
    isLoading,
    mutate,
  } = useLocalClippingJob(currentId);

  function pickLibraryVideo() {
    modals.openModal({
      title: 'Escolher vídeo da biblioteca',
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      children: (close) => (
        <MediaBox
          type="video"
          closeModal={close}
          setMedia={(media) => {
            if (media.length !== 1) {
              setError('Selecione um vídeo da biblioteca por vez.');
              return;
            }
            setError('');
            setLibraryVideo(media[0]);
          }}
        />
      ),
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('video');
    if (
      !libraryVideo &&
      (!(file instanceof File) || !file.name.toLowerCase().endsWith('.mp4'))
    ) {
      setError('Escolha um arquivo MP4.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let mediaId = libraryVideo?.id;
      if (!mediaId && file instanceof File) {
        const upload = new FormData();
        upload.append('file', file);
        const media = await readResponse<{ id: string }>(
          await fetch('/media/upload-server', { method: 'POST', body: upload })
        );
        mediaId = media.id;
      }
      const job = await readResponse<{ id: string }>(
        await fetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            mediaId,
            language: data.get('language'),
            startSeconds: Number(data.get('start')),
          }),
        })
      );
      setSelectedId(job.id);
      setLibraryVideo(undefined);
      form.reset();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'O envio do vídeo falhou.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-label="Clipagem inteligente"
      className="flex flex-col gap-5 rounded border border-newBorder bg-newBgColor p-5"
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          Vídeo MP4
          <input
            required={!libraryVideo}
            disabled={!!libraryVideo}
            className={fieldClass}
            name="video"
            type="file"
            accept="video/mp4,.mp4"
          />
        </label>
        <Button secondary disabled={submitting} onClick={pickLibraryVideo}>
          Escolher da biblioteca
        </Button>
        <label className="flex flex-col gap-1">
          Início do trecho (segundos)
          <input
            required
            className={fieldClass}
            name="start"
            type="number"
            defaultValue="0"
            min="0"
            max="10799"
            step="1"
          />
        </label>
        <label className="flex flex-col gap-1">
          Idioma da fala
          <select className={fieldClass} name="language" defaultValue="pt">
            <option value="pt">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </select>
        </label>
        <Button
          type="submit"
          loading={submitting}
          disabled={submitting || jobs.some(active)}
        >
          Gerar cortes
        </Button>
        {libraryVideo && (
          <p className="flex w-full flex-wrap items-center gap-2 text-sm">
            {libraryVideo.originalName || 'Vídeo da biblioteca selecionado'}
            <button
              type="button"
              className="underline"
              disabled={submitting}
              onClick={() => setLibraryVideo(undefined)}
            >
              Limpar seleção
            </button>
          </p>
        )}
        <p className="w-full text-sm opacity-80">
          O processamento analisa até cinco minutos a partir do início
          escolhido.
        </p>
      </form>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {(jobs.length > 0 || currentId) && (
        <label className="flex flex-col gap-1">
          Vídeos enviados para clipagem
          <select
            className={fieldClass}
            value={currentId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {currentId && !jobs.some((job) => job.id === currentId) && (
              <option value={currentId}>Vídeo recém-enviado</option>
            )}
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {labels[job.status]}
              </option>
            ))}
          </select>
        </label>
      )}
      {isLoading && <p role="status">Carregando cortes…</p>}
      {jobError && (
        <p role="alert" className="text-sm text-red-400">
          {jobError.message}
        </p>
      )}
      {result && (
        <>
          <p role="status">{labels[result.status]}</p>
          {result.error && (
            <p role="alert" className="text-sm text-red-400">
              {result.error}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {result.clips.map((clip) => (
              <ClipReview
                key={clip.id}
                jobId={result.id}
                clip={clip}
                channels={channels}
                refresh={mutate}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
