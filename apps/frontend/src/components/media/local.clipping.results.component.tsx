'use client';

import { useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type Metric = {
  label: string;
  data: { total: number; date: string }[];
  average?: boolean;
};

type LinkClick = {
  short: string;
  original: string;
  clicks: number;
};

type Results = {
  metrics: Metric[];
  clicks: LinkClick[];
  missingRelease: boolean;
  partial: boolean;
};

const periods = [7, 30, 90] as const;
type Period = (typeof periods)[number];

function metricTotal(metric: Metric) {
  const points = (metric.data || [])
    .map((item) => Number(item.total))
    .filter((item) => Number.isFinite(item));
  const sum = points.reduce((acc, item) => acc + item, 0);
  return metric.average && points.length ? sum / points.length : sum;
}

function metricValue(metric: Metric) {
  return (
    new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: metric.average ? 2 : 0,
    }).format(metricTotal(metric)) + (metric.average ? '%' : '')
  );
}

/**
 * Post-specific insight bridge: uses Postiz's native APIs on demand.
 * Never polls automatically, publishes content, or treats clicks as conversions.
 */
export function LocalClippingResults({ postId }: { postId: string }) {
  const request = useFetch();
  const [opened, setOpened] = useState(false);
  const [period, setPeriod] = useState<Period>(30);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState('');

  async function load(days: Period) {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const [analytics, links] = await Promise.allSettled([
        request('/analytics/post/' + encodeURIComponent(postId) + '?date=' + days)
          .then(async (response) => {
            if (!response.ok) throw new Error('Analytics unavailable');
            return response.json();
          }),
        request('/posts/' + encodeURIComponent(postId) + '/statistics')
          .then(async (response) => {
            if (!response.ok) throw new Error('Link statistics unavailable');
            return response.json();
          }),
      ]);

      if (analytics.status === 'rejected' && links.status === 'rejected') {
        throw new Error('Não foi possível consultar as estatísticas deste post.');
      }
      const analyticsBody =
        analytics.status === 'fulfilled' ? analytics.value : null;
      const linksBody = links.status === 'fulfilled' ? links.value : null;
      const metrics: Metric[] = Array.isArray(analyticsBody)
        ? analyticsBody.filter(
            (item: unknown): item is Metric =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as Metric).label === 'string' &&
              Array.isArray((item as Metric).data)
          )
        : [];
      const clicks: LinkClick[] = Array.isArray(linksBody?.clicks)
        ? linksBody.clicks.filter(
            (item: unknown): item is LinkClick =>
              !!item &&
              typeof item === 'object' &&
              typeof (item as LinkClick).short === 'string' &&
              Number.isFinite(Number((item as LinkClick).clicks))
          )
        : [];
      setResults({
        metrics,
        clicks,
        missingRelease: analyticsBody?.missing === true,
        partial: analytics.status === 'rejected' || links.status === 'rejected',
      });
    } catch (err) {
      setResults(null);
      setError(
        err instanceof Error ? err.message : 'Erro ao consultar os resultados.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    if (opened) {
      setOpened(false);
      return;
    }
    setOpened(true);
    if (!results) await load(period);
  }

  function changePeriod(value: string) {
    const next = Number(value);
    if (next !== 7 && next !== 30 && next !== 90) return;
    setPeriod(next);
    void load(next);
  }

  return (
    <div className="rounded border border-newBorder p-3 text-sm">
      <button
        type="button"
        className="underline"
        aria-expanded={opened}
        onClick={() => void toggle()}
      >
        {opened ? 'Ocultar resultados deste corte' : 'Ver resultados deste corte'}
      </button>
      {opened && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={'clip-results-period-' + postId}>
              Período
            </label>
            <select
              id={'clip-results-period-' + postId}
              className="rounded border border-newBorder bg-newBgColor p-2"
              value={period}
              disabled={loading}
              onChange={(event) => changePeriod(event.target.value)}
            >
              {periods.map((days) => (
                <option key={days} value={days}>{days} dias</option>
              ))}
            </select>
            <button
              type="button"
              className="underline"
              disabled={loading}
              onClick={() => void load(period)}
            >
              Atualizar
            </button>
          </div>
          {loading && <p role="status">Consultando os canais conectados…</p>}
          {error && <p role="alert" className="text-red-400">{error}</p>}
          {results && !loading && (
            <>
              {results.missingRelease && (
                <p>
                  O identificador externo da publicação ainda não está
                  disponível. Verifique o post no calendário.
                </p>
              )}
              {results.partial && (
                <p>
                  Uma das fontes de dados não respondeu. Os valores exibidos
                  abaixo podem estar incompletos.
                </p>
              )}
              {!!results.metrics.length && (
                <dl className="grid grid-cols-2 gap-2">
                  {results.metrics.map((metric, index) => (
                    <div key={metric.label + index} className="rounded border border-newBorder p-2">
                      <dt className="opacity-80">{metric.label}</dt>
                      <dd className="font-semibold">{metricValue(metric)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!!results.clicks.length && (
                <p>
                  Cliques em links rastreados: {' '}
                  <strong>
                    {new Intl.NumberFormat('pt-BR').format(
                      results.clicks.reduce(
                        (total, item) => total + Number(item.clicks),
                        0
                      )
                    )}
                  </strong>
                </p>
              )}
              {!results.metrics.length && !results.clicks.length && (
                <p>Nenhuma métrica disponível para este período ou canal.</p>
              )}
              <p className="opacity-80">
                Dados informados pelas integrações do Postiz. Cliques não
                representam necessariamente leads, reuniões ou vendas.
                Compare os resultados antes de repetir esta abordagem.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
