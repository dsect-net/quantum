/**
 * Home tab — the hub-api dashboard.
 *
 * Sections: services (registry + live probes), metrics (host vitals),
 * agents (fleet roster), docket (the wishlist board). Data comes only from
 * the hub-api endpoints this module wires (src/api/hub.ts); nothing is
 * invented client-side.
 *
 * Honesty states, in order of precedence:
 *  1. No Hub API base URL → demo mode: the DemoBanner plus honest per-section
 *     empty states. No network attempts.
 *  2. Configured but unreachable / HTTP error → per-section error cards with
 *     the real failure reason and a retry button; a fully-dead dashboard gets
 *     one prominent connection-error card.
 *  3. Partial outage → only the failing section degrades; the rest render.
 * Pull-to-refresh is intentionally out of scope (task: "fine without") —
 * the 44px refresh button in the header does the job.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import type { Tone } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { Bars, Meter, Metric } from '@dsect/ui/components/telemetry';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';
import {
  HubClient,
  fetchDashboard,
  type Dashboard,
  type HubAgent,
  type HubDocketItem,
  type HubService,
  type HubVitals,
  type ServiceStatus,
} from '../api/hub';

/* ------------------------------------------------------------------ */
/* Small honest formatters                                             */
/* ------------------------------------------------------------------ */

/** Humanize seconds of uptime: "3d 4h", "5h 12m", "42m", "<1m". */
export function formatUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return '<1m';
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

const SERVICE_TONE: Record<ServiceStatus, Tone> = {
  up: 'ok',
  degraded: 'warn',
  down: 'err',
  unknown: 'slate',
};

const DOCKET_TONE: Record<string, Tone> = {
  queued: 'info',
  approved: 'ok',
  purchased: 'slate',
  dropped: 'neutral',
};

/** Down/degraded first so problems are visible without scrolling. */
const SERVICE_RANK: Record<ServiceStatus, number> = {
  down: 0,
  degraded: 1,
  unknown: 2,
  up: 3,
};

/* ------------------------------------------------------------------ */
/* Section scaffolding                                                 */
/* ------------------------------------------------------------------ */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-3">
      <EmptyState
        mark="!"
        title="Couldn't load this section"
        text={<span className="font-mono text-xs">{message}</span>}
        actions={
          <button
            type="button"
            onClick={onRetry}
            className="flex min-h-[44px] items-center rounded-lg border px-4 text-sm font-medium"
          >
            Retry
          </button>
        }
      />
    </Card>
  );
}

function DemoEmpty({ what }: { what: string }) {
  return (
    <Card className="p-3">
      <EmptyState
        mark="◌"
        title="Demo mode"
        text={`No Hub API base URL configured. ${what} will appear here once you connect.`}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function ServicesSection({
  services,
  error,
  onRetry,
  demo,
}: {
  services: HubService[] | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="Live service health" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!services) {
    return (
      <Card className="p-6">
        <Spinner label="Loading services" />
      </Card>
    );
  }
  if (services.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No services in the registry" />
      </Card>
    );
  }
  const sorted = [...services].sort(
    (a, b) => SERVICE_RANK[a.status] - SERVICE_RANK[b.status] || a.name.localeCompare(b.name),
  );
  const up = services.filter((s) => s.status === 'up').length;
  const lat = services
    .map((s) => s.latencyMs)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  return (
    <Card className="p-3">
      <p className="mb-2 text-sm text-text-secondary" data-testid="services-summary">
        <strong className="text-text-primary">{up}/{services.length}</strong> up
        {median != null && <> · median probe <strong className="text-text-primary">{median} ms</strong></>}
      </p>
      <ul className="flex flex-col gap-2">
        {sorted.map((svc) => (
          <li
            key={svc.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{svc.name}</p>
              <p className="truncate text-xs text-text-secondary">
                {svc.cat}
                {svc.latencyMs != null && <> · {svc.latencyMs} ms</>}
                {svc.sinceSec != null && svc.sinceSec > 0 && <> · up {formatUptime(svc.sinceSec)}</>}
              </p>
            </div>
            <Badge tone={SERVICE_TONE[svc.status]} size="sm" dot>
              {svc.status}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function memoryLevel(pct: number | null): 'ok' | 'warn' | 'err' {
  if (pct == null) return 'ok';
  if (pct >= 95) return 'err';
  if (pct >= 85) return 'warn';
  return 'ok';
}

function MetricsSection({
  vitals,
  history,
  error,
  onRetry,
  demo,
}: {
  vitals: HubVitals | null;
  history: { cpu: number | null }[] | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="Live host metrics" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!vitals) {
    return (
      <Card className="p-6">
        <Spinner label="Loading metrics" />
      </Card>
    );
  }
  const samples = (history ?? []).map((p) => (p.cpu == null ? 0 : Math.min(1, p.cpu / 100)));
  const cpuVals = (history ?? []).map((p) => p.cpu).filter((n): n is number => n != null);
  const avg = cpuVals.length ? Math.round(cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length) : null;
  const peak = cpuVals.length ? Math.max(...cpuVals) : null;
  return (
    <Card className="p-3">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="CPU"
          value={vitals.cpuPct == null ? '—' : `${vitals.cpuPct}%`}
          delta={vitals.cpuPct == null ? 'awaiting first sample' : undefined}
        />
        <Metric
          label="Load (1m)"
          value={vitals.load1 == null ? '—' : vitals.load1.toFixed(2)}
        />
        <div className="col-span-2">
          <Meter
            label="Memory"
            value={
              vitals.memPct == null
                ? '—'
                : `${vitals.memUsedGB ?? '?'} / ${vitals.memTotalGB ?? '?'} GB · ${vitals.memPct}%`
            }
            percent={vitals.memPct ?? 0}
            level={memoryLevel(vitals.memPct)}
          />
        </div>
        <Metric label="Host uptime" value={formatUptime(vitals.uptimeSec)} />
        {vitals.gpus.map((g) => (
          <Metric
            key={g.vendor}
            label={g.vendor === 'amd' ? 'iGPU temp' : g.vendor === 'nvidia' ? 'dGPU temp' : `${g.vendor} temp`}
            value={g.tempC == null ? '—' : `${g.tempC} °C`}
          />
        ))}
      </div>
      {samples.length > 1 && avg != null && (
        <div className="mt-3">
          <Bars
            values={samples}
            size="md"
            label={`CPU over the last hour: average ${avg}%, peak ${peak}%`}
            tone={(v) => (v >= 0.9 ? 'hot' : undefined)}
          />
        </div>
      )}
    </Card>
  );
}

function AgentsSection({
  agents,
  error,
  onRetry,
  demo,
}: {
  agents: HubAgent[] | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="The agent roster" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!agents) {
    return (
      <Card className="p-6">
        <Spinner label="Loading agents" />
      </Card>
    );
  }
  if (agents.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No agents listed" text="The roster came back empty." />
      </Card>
    );
  }
  return (
    <Card className="p-3">
      <ul className="grid grid-cols-2 gap-2">
        {agents.map((a) => (
          <li key={String(a.id ?? a.slug ?? a.name)} className="rounded-lg border border-dashed p-2">
            <p className="truncate text-sm font-medium">{a.name}</p>
            <p className="truncate text-xs text-text-secondary">
              {a.slug && a.slug !== a.name && <>@{a.slug} · </>}
              {a.entries != null ? `${a.entries} ledger entries` : 'rostered'}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const DOCKET_PAGE = 8;

function DocketSection({
  items,
  error,
  onRetry,
  demo,
}: {
  items: HubDocketItem[] | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="Docket items" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!items) {
    return (
      <Card className="p-6">
        <Spinner label="Loading docket" />
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No docket items" text="The board is empty." />
      </Card>
    );
  }
  const shown = items.slice(0, DOCKET_PAGE);
  return (
    <Card className="p-3">
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-dashed p-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="truncate text-xs text-text-secondary">
                {[item.category, item.updatedAt ? formatDate(item.updatedAt) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Badge tone={DOCKET_TONE[item.status] ?? 'neutral'} size="sm">
              {item.status}
            </Badge>
          </li>
        ))}
      </ul>
      {items.length > DOCKET_PAGE && (
        <p className="mt-2 text-xs text-text-secondary">
          +{items.length - DOCKET_PAGE} more on the docket board
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

export function HomeScreen() {
  const settings = getSettings();
  const baseUrl = settings.hub.baseUrl;
  const client = useMemo(() => new HubClient(baseUrl), [baseUrl]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!client.configured) return;
    setLoading(true);
    try {
      const next = await fetchDashboard(client, 60);
      setDash(next);
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client.configured) {
      setDash(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchDashboard(client, 60)
      .then((next) => {
        if (cancelled) return;
        setDash(next);
        setUpdatedAt(new Date());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const demo = !client.configured;
  const errOf = (section: { error: { message: string } | null }) =>
    section.error?.message ?? null;
  const allFailed =
    !demo &&
    dash != null &&
    dash.services.status === 'error' &&
    dash.agents.status === 'error' &&
    dash.vitals.status === 'error' &&
    dash.metrics.status === 'error' &&
    dash.docket.status === 'error';

  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!demo} serviceLabel="Hub API" />

      {!demo && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-secondary" aria-live="polite">
            {loading
              ? 'Refreshing…'
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString()}`
                : 'Connecting…'}
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh dashboard"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      )}

      {allFailed && dash && (
        <Card className="p-3">
          <EmptyState
            mark="!"
            title="Hub API unreachable"
            text={
              <span className="font-mono text-xs">
                {dash.services.error?.message ??
                  'Every dashboard endpoint failed. Check the tailnet connection and the base URL in settings.'}
              </span>
            }
            actions={
              <button
                type="button"
                onClick={refresh}
                className="flex min-h-[44px] items-center rounded-lg border px-4 text-sm font-medium"
              >
                Try again
              </button>
            }
          />
        </Card>
      )}

      {!allFailed && (
        <>
          <Section title="Services">
            <ServicesSection
              services={dash?.services.data ?? null}
              error={dash ? errOf(dash.services) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="Metrics">
            <MetricsSection
              vitals={dash?.vitals.data ?? null}
              history={dash?.metrics.data ?? null}
              error={dash ? (errOf(dash.vitals) ?? errOf(dash.metrics)) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="Agents">
            <AgentsSection
              agents={dash?.agents.data ?? null}
              error={dash ? errOf(dash.agents) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="Docket">
            <DocketSection
              items={dash?.docket.data ?? null}
              error={dash ? errOf(dash.docket) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>
        </>
      )}
    </div>
  );
}
