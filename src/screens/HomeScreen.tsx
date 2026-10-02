/**
 * Home tab — the DSECT Operations Hub dashboard, mobile edition.
 *
 * Mirrors the information architecture of the hub-api www console
 * (dsect-net/hub-api, www/index.html), re-laid-out for a phone:
 *
 *   Hero               greeting + date + services indexed      (/api/summary)
 *   At a glance        link state, stat tiles, key rows        (/api/summary, /api/vitals, /api/metrics)
 *   01 · Services      registry + live probes, searchable      (/api/services, /api/status)
 *   02 · System vitals CPU/mem/swap + load/net/uptime          (/api/vitals, /api/metrics)
 *   03 · Graphics      GPU cards                               (/api/vitals)
 *   04 · Agents on the roll  roster with ledger entry counts   (/api/agents)
 *   Wishlist           the docket board                        (/api/docket/items)
 *   10 · Addresses     port → name directory                   (/api/services registry)
 *
 * Honesty states, in order of precedence:
 *  1. No Hub API base URL → demo mode: the DemoBanner plus honest per-section
 *     empty states. No network attempts.
 *  2. Configured but unreachable / HTTP error → per-section error cards with
 *     the real failure reason and a retry button; a fully-dead dashboard gets
 *     one prominent connection-error card.
 *  3. Partial outage → only the failing section degrades; the rest render.
 * The 44px refresh button in the header does the job (no pull-to-refresh).
 *
 * www sections NOT wired here — no endpoint in src/api/hub.ts, which this
 * screen must not extend: the NPU daily brief (/api/brief), Reeve's ledger
 * feed (/api/ledger), backups (/api/backups), health log (/api/alerts),
 * storage (/api/storage), tailnet (/api/tailnet), RSS feeds (/api/feeds),
 * the service detail drawer (/api/logs), root-disk usage, GPU memory/power.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import type { Tone } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { Bars, KeyValue, Meter, Metric } from '@dsect/ui/components/telemetry';
import { StateIndicator } from '@dsect/ui/components/status';
import { QButton, QInput, QToggle } from '../lib/untitled';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';
import {
  HubClient,
  HubError,
  fetchDashboard,
  type Dashboard,
  type DashboardSection,
  type HubAgent,
  type HubDocketItem,
  type HubService,
  type HubSummary,
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

/** Same time-of-day rule as the www hero ("Good morning/afternoon/evening"). */
function todGreeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
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

const SORT_MODES = ['status', 'name', 'latency'] as const;
type SortMode = (typeof SORT_MODES)[number];
const SORT_LABEL: Record<SortMode, string> = {
  status: 'Needs attention',
  name: 'Name A–Z',
  latency: 'Fastest first',
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
          <QButton color="secondary" onPress={onRetry}>
            Retry
          </QButton>
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
/* Hero — www greeting + date + services indexed                       */
/* ------------------------------------------------------------------ */

function HeroSection({
  summary,
  error,
  onRetry,
  demo,
  updatedAt,
  loading,
  onRefresh,
}: {
  summary: HubSummary | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
  updatedAt: Date | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const date = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const total = summary?.services?.total;
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-text-secondary">
        Operations Hub · {date}
        {total != null && <> · {total} services indexed</>}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">
        {todGreeting()},<br />
        <span className="text-text-secondary">Scotty.</span>
      </h1>
      {demo ? (
        <div className="mt-3">
          <DemoEmpty what="The live estate overview" />
        </div>
      ) : error ? (
        <div className="mt-3">
          <SectionError message={error} onRetry={onRetry} />
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-text-secondary" aria-live="polite">
            {loading
              ? 'Refreshing…'
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString()}`
                : 'Connecting…'}
          </p>
          <QButton
            color="secondary"
            size="md"
            aria-label="Refresh dashboard"
            isDisabled={loading}
            isLoading={loading}
            iconLeading={<RefreshCw size={16} data-icon />}
            onPress={onRefresh}
          >
            Refresh
          </QButton>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* At a glance — www link state + stat strip + glance rows             */
/* ------------------------------------------------------------------ */

function glanceLinkState(summary: HubSummary | null): {
  state: 'ready' | 'alert' | 'unknown';
  text: string;
} {
  const sv = summary?.services;
  if (!sv || sv.total == null) return { state: 'unknown', text: 'LINK UNKNOWN' };
  const bad = sv.total - sv.up;
  if (bad === 0) return { state: 'ready', text: 'ALL SYSTEMS NOMINAL' };
  return { state: 'alert', text: `${bad} SERVICE${bad > 1 ? 'S' : ''} DOWN` };
}

function GlanceSection({
  summary,
  vitals,
  latestWatts,
  agentCount,
  error,
  onRetry,
  demo,
}: {
  summary: HubSummary | null;
  vitals: HubVitals | null;
  latestWatts: number | null;
  agentCount: number | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="The at-a-glance estate status" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!summary) {
    return (
      <Card className="p-6">
        <Spinner label="Loading estate status" />
      </Card>
    );
  }
  const link = glanceLinkState(summary);
  const sv = summary.services;
  const igpu = (vitals?.gpus ?? []).find((g) => g.vendor === 'amd') ?? vitals?.gpus[0];
  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <StateIndicator state={link.state}>{link.text}</StateIndicator>
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Live
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Services online"
          value={sv ? `${sv.up}/${sv.total}` : '—'}
          delta={sv?.pct != null ? `${sv.pct}% reachable` : undefined}
        />
        <Metric
          label="Median latency"
          value={sv?.medianLatencyMs != null ? `${sv.medianLatencyMs} ms` : '—'}
          delta={sv?.p95LatencyMs != null ? `p95 ${sv.p95LatencyMs} ms` : 'loopback'}
        />
        <Metric
          label={igpu?.name ?? (igpu?.vendor === 'nvidia' ? 'dGPU temp' : 'GPU temp')}
          value={igpu?.tempC != null ? `${igpu.tempC} °C` : '—'}
          delta={igpu?.busyPct != null ? `busy ${igpu.busyPct}%` : undefined}
        />
        <Metric label="Host uptime" value={formatUptime(vitals?.uptimeSec)} />
      </div>
      <div className="mt-3 border-t border-dashed pt-3">
        <KeyValue
          items={[
            {
              label: 'Power draw',
              value: latestWatts != null ? `${latestWatts} W` : '—',
              numeric: true,
            },
            {
              label: 'Agents on the roll',
              value: agentCount != null ? `${agentCount} on record` : '—',
              numeric: true,
            },
          ]}
        />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 01 · Services — www filter row + live grid                          */
/* ------------------------------------------------------------------ */

const SERVICE_PAGE = 8;

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
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('status');
  const [hideDown, setHideDown] = useState(false);
  const [expanded, setExpanded] = useState(false);

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

  const q = query.trim().toLowerCase();
  const filtered = services.filter((s) => {
    if (hideDown && s.status !== 'up') return false;
    if (!q) return true;
    return [s.name, s.cat, s.id, String(s.port ?? ''), ...(s.tags ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name);
    if (sortMode === 'latency') {
      const la = a.latencyMs ?? Number.POSITIVE_INFINITY;
      const lb = b.latencyMs ?? Number.POSITIVE_INFINITY;
      return la - lb || a.name.localeCompare(b.name);
    }
    return SERVICE_RANK[a.status] - SERVICE_RANK[b.status] || a.name.localeCompare(b.name);
  });
  const up = services.filter((s) => s.status === 'up').length;
  const lat = services
    .map((s) => s.latencyMs)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
  const shown = expanded ? sorted : sorted.slice(0, SERVICE_PAGE);
  const cycleSort = () =>
    setSortMode(SORT_MODES[(SORT_MODES.indexOf(sortMode) + 1) % SORT_MODES.length]);

  return (
    <div className="flex flex-col gap-2">
      <QInput
        label="Search services"
        placeholder="Search services, ports, subdomains…"
        value={query}
        onChange={setQuery}
        aria-label="Search services"
      />
      <div className="flex items-center justify-between gap-2">
        <QButton color="secondary" size="md" onPress={cycleSort}>
          Sort · {SORT_LABEL[sortMode]}
        </QButton>
        <QToggle
          aria-label="Hide attention-needed"
          label="Hide attention-needed"
          isSelected={hideDown}
          onChange={setHideDown}
        />
      </div>
      <Card className="p-3">
        <p className="mb-2 text-sm text-text-secondary" data-testid="services-summary">
          <strong className="text-text-primary">
            {up}/{services.length}
          </strong>{' '}
          up
          {median != null && (
            <>
              {' '}
              · median probe{' '}
              <strong className="text-text-primary">{median} ms</strong>
            </>
          )}
        </p>
        {sorted.length === 0 ? (
          <EmptyState
            mark="∅"
            title="Nothing in this drawer."
            text="No services match that search. Try a subdomain, a port, or 'gpu'."
            actions={
              <QButton
                color="secondary"
                size="md"
                onPress={() => {
                  setQuery('');
                  setHideDown(false);
                }}
              >
                Clear filters
              </QButton>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="services-list">
            {shown.map((svc) => (
              <li
                key={svc.id}
                className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-dashed p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{svc.name}</p>
                  <p className="truncate text-xs text-text-secondary">
                    {svc.cat}
                    {svc.port != null && <> · :{svc.port}</>}
                    {svc.latencyMs != null && <> · {svc.latencyMs} ms</>}
                    {svc.sinceSec != null && svc.sinceSec > 0 && (
                      <> · up {formatUptime(svc.sinceSec)}</>
                    )}
                  </p>
                </div>
                <Badge tone={SERVICE_TONE[svc.status]} size="sm" dot>
                  {svc.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {sorted.length > SERVICE_PAGE && (
          <div className="mt-2 flex justify-center">
            <QButton color="tertiary" size="md" onPress={() => setExpanded((v) => !v)}>
              {expanded ? 'Show fewer' : `Show all ${sorted.length}`}
            </QButton>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 02 · System vitals — www bars + load/net/uptime foot                */
/* ------------------------------------------------------------------ */

function memoryLevel(pct: number | null): 'ok' | 'warn' | 'err' {
  if (pct == null) return 'ok';
  if (pct >= 95) return 'err';
  if (pct >= 85) return 'warn';
  return 'ok';
}

function VitalsSection({
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
      <div className="flex flex-col gap-3">
        <Meter
          label="CPU"
          value={vitals.cpuPct == null ? '—' : `${vitals.cpuPct}%`}
          percent={vitals.cpuPct ?? 0}
          level={vitals.cpuPct != null && vitals.cpuPct >= 90 ? 'err' : 'ok'}
        />
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
        <Meter
          label="Swap"
          value={vitals.swapPct == null ? '—' : `${vitals.swapPct}%`}
          percent={vitals.swapPct ?? 0}
          level={memoryLevel(vitals.swapPct)}
        />
      </div>
      <div className="mt-3 border-t border-dashed pt-3">
        <KeyValue
          items={[
            {
              label: 'Load (1m)',
              value: vitals.load1 == null ? '—' : vitals.load1.toFixed(2),
              numeric: true,
            },
            {
              label: 'Net ↓ / ↑ (KB/s)',
              value:
                vitals.rxKBs == null || vitals.txKBs == null
                  ? '—'
                  : `${vitals.rxKBs} / ${vitals.txKBs}`,
              numeric: true,
            },
            {
              label: 'Uptime',
              value: formatUptime(vitals.uptimeSec),
              numeric: true,
            },
          ]}
        />
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

/* ------------------------------------------------------------------ */
/* 03 · Graphics — www two-card GPU panel                              */
/* ------------------------------------------------------------------ */

function GraphicsSection({
  vitals,
  error,
  onRetry,
  demo,
}: {
  vitals: HubVitals | null;
  error: string | null;
  onRetry: () => void;
  demo: boolean;
}) {
  if (demo) return <DemoEmpty what="GPU telemetry" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!vitals) {
    return (
      <Card className="p-6">
        <Spinner label="Loading graphics" />
      </Card>
    );
  }
  if (vitals.gpus.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No GPU sensors readable" />
      </Card>
    );
  }
  return (
    <Card className="p-3">
      <div className="flex flex-col gap-3">
        {vitals.gpus.map((g) => (
          <div key={g.vendor}>
            <Meter
              label={g.name ?? (g.vendor === 'amd' ? 'iGPU' : g.vendor === 'nvidia' ? 'dGPU' : g.vendor)}
              value={g.tempC == null ? '—' : `${g.tempC} °C`}
              percent={g.busyPct ?? 0}
              level={g.busyPct != null && g.busyPct > 75 ? 'warn' : 'ok'}
            />
            <p className="mt-1 text-xs text-text-secondary">
              {g.busyPct == null ? 'utilisation unavailable' : `${g.busyPct}% busy`}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 04 · Agents on the roll — www Reeve roll, via /api/agents           */
/* ------------------------------------------------------------------ */

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
          <li
            key={String(a.id ?? a.slug ?? a.name)}
            className="min-h-[44px] rounded-lg border border-dashed p-2"
          >
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

/* ------------------------------------------------------------------ */
/* Wishlist — the www Wishlist module (/api/docket/items)               */
/* ------------------------------------------------------------------ */

const DOCKET_PAGE = 8;

function WishlistSection({
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
  if (demo) return <DemoEmpty what="Wishlist items" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!items) {
    return (
      <Card className="p-6">
        <Spinner label="Loading wishlist" />
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No wishlist items" text="The board is empty." />
      </Card>
    );
  }
  const shown = items.slice(0, DOCKET_PAGE);
  return (
    <Card className="p-3">
      <ul className="flex flex-col gap-2">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex min-h-[44px] items-start justify-between gap-3 rounded-lg border border-dashed p-2"
          >
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
          +{items.length - DOCKET_PAGE} more on the wishlist board
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 10 · Addresses — www port → name table                              */
/* ------------------------------------------------------------------ */

function AddressesSection({
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
  if (demo) return <DemoEmpty what="The port → name directory" />;
  if (error) return <SectionError message={error} onRetry={onRetry} />;
  if (!services) {
    return (
      <Card className="p-6">
        <Spinner label="Loading addresses" />
      </Card>
    );
  }
  if (services.length === 0) {
    return (
      <Card className="p-3">
        <EmptyState mark="∅" title="No addresses mapped" />
      </Card>
    );
  }
  const sorted = [...services].sort((a, b) => (a.port ?? 0) - (b.port ?? 0) || a.name.localeCompare(b.name));
  return (
    <Card className="p-3">
      <ul className="flex flex-col gap-2" data-testid="addresses-list">
        {sorted.map((svc) => (
          <li
            key={svc.id}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-dashed p-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                <span className="font-mono text-text-secondary">
                  {svc.port != null && svc.port > 0 ? `:${svc.port}` : '—'}
                </span>{' '}
                {svc.name}
              </p>
              <p className="truncate font-mono text-xs text-text-secondary">
                {svc.url ?? (svc.port != null && svc.port > 0 ? `127.0.0.1:${svc.port}` : 'loopback')}
              </p>
            </div>
            <Badge tone={SERVICE_TONE[svc.status]} size="sm" dot>
              {svc.status}
            </Badge>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-secondary">
        One name per service instead of a sticky note of ports.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */
/* ------------------------------------------------------------------ */

interface ScreenState {
  dash: Dashboard;
  summary: DashboardSection<HubSummary>;
}

async function settleSummary(
  promise: Promise<HubSummary>,
): Promise<DashboardSection<HubSummary>> {
  try {
    return { status: 'ok', data: await promise, error: null };
  } catch (err) {
    const error =
      err instanceof HubError ? err : new HubError('network', String(err));
    return { status: 'error', data: null, error };
  }
}

export function HomeScreen() {
  const settings = getSettings();
  const baseUrl = settings.hub.baseUrl;
  const client = useMemo(() => new HubClient(baseUrl), [baseUrl]);
  const [state, setState] = useState<ScreenState | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    if (!client.configured) return;
    setLoading(true);
    try {
      const [dash, summary] = await Promise.all([
        fetchDashboard(client, 60),
        settleSummary(client.summary()),
      ]);
      setState({ dash, summary });
      setUpdatedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    if (!client.configured) {
      setState(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchDashboard(client, 60), settleSummary(client.summary())])
      .then(([dash, summary]) => {
        if (cancelled) return;
        setState({ dash, summary });
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
  const dash = state?.dash ?? null;
  const summarySection = state?.summary ?? null;
  const errOf = (section: { error: { message: string } | null }) =>
    section.error?.message ?? null;
  const allFailed =
    !demo &&
    state != null &&
    state.dash.services.status === 'error' &&
    state.dash.agents.status === 'error' &&
    state.dash.vitals.status === 'error' &&
    state.dash.metrics.status === 'error' &&
    state.dash.docket.status === 'error' &&
    state.summary.status === 'error';

  const vitals = dash?.vitals.data ?? null;
  const metrics = dash?.metrics.data ?? null;
  const latestWatts = (() => {
    if (!metrics) return null;
    for (let i = metrics.length - 1; i >= 0; i--) {
      const w = metrics[i].watts;
      if (w != null) return w;
    }
    return null;
  })();
  const agentCount =
    summarySection?.data?.agents ?? dash?.agents.data?.length ?? null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!demo} serviceLabel="Hub API" />

      {allFailed && state && (
        <Card className="p-3">
          <EmptyState
            mark="!"
            title="Hub API unreachable"
            text={
              <span className="font-mono text-xs">
                {state.dash.services.error?.message ??
                  'Every dashboard endpoint failed. Check the tailnet connection and the base URL in settings.'}
              </span>
            }
            actions={
              <QButton color="secondary" onPress={refresh}>
                Try again
              </QButton>
            }
          />
        </Card>
      )}

      {!allFailed && (
        <>
          <HeroSection
            summary={summarySection?.data ?? null}
            error={summarySection ? errOf(summarySection) : null}
            onRetry={refresh}
            demo={demo}
            updatedAt={updatedAt}
            loading={loading}
            onRefresh={refresh}
          />

          <Section title="At a glance">
            <GlanceSection
              summary={summarySection?.data ?? null}
              vitals={vitals}
              latestWatts={latestWatts}
              agentCount={agentCount}
              error={summarySection ? errOf(summarySection) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="01 · Services">
            <ServicesSection
              services={dash?.services.data ?? null}
              error={dash ? errOf(dash.services) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="02 · System vitals">
            <VitalsSection
              vitals={vitals}
              history={metrics}
              error={dash ? (errOf(dash.vitals) ?? errOf(dash.metrics)) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="03 · Graphics">
            <GraphicsSection
              vitals={vitals}
              error={dash ? errOf(dash.vitals) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="04 · Agents on the roll">
            <AgentsSection
              agents={dash?.agents.data ?? null}
              error={dash ? errOf(dash.agents) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="Wishlist">
            <WishlistSection
              items={dash?.docket.data ?? null}
              error={dash ? errOf(dash.docket) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>

          <Section title="10 · Addresses">
            <AddressesSection
              services={dash?.services.data ?? null}
              error={dash ? errOf(dash.services) : null}
              onRetry={refresh}
              demo={demo}
            />
          </Section>
        </>
      )}
    </div>
  );
}
