/**
 * Create → Jobs: the Nebula job queue, live.
 *
 * Polls GET /api/jobs every 2.5 s while mounted (the server's own UI does
 * the same). Mirrors Nebula's jobs tab:
 *  - the queue note line ("N waiting for a free backend · M active",
 *    "ComfyUI is mid-render and not answering — showing what is known",
 *    "nothing running");
 *  - job rows with state badge, title, workflow/user/device/queued meta,
 *    a progress row showing phase, percent, and step value/max, output
 *    thumbnails, and a Cancel action.
 *
 * Active jobs show state + server-reported progress; recent jobs show their
 * terminal state exactly as the server reported it ("cancelled" stays
 * "cancelled", "error" stays "error" — a job the user stopped on purpose
 * never wears a red error badge here). A finished job's Outputs button
 * reveals its full output images; active jobs can be cancelled.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, ProgressBar, Spinner } from '@dsect/ui/components/feedback';
import { QButton } from '../../lib/untitled';
import {
  cancelJob,
  getJobs,
  type JobsResponse,
  type NebulaJob,
} from '../../api/nebula';
import type { CreateConnection } from './NewRunView';
import { ErrorBox } from './NewRunView';
import { AuthenticatedImage } from './AuthenticatedImage';

const POLL_MS = 2500;

export interface JobsViewProps {
  conn: CreateConnection;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NebulaApiError') {
      const code = (error as { code?: string }).code;
      if (code === 'auth')
        return 'Nebula refused the credentials. If you are off the tailnet, check the Nebula passphrase in Connection settings (More tab).';
      if (code === 'network')
        return 'Could not reach Nebula. Check the base URL in Connection settings and that the service is up.';
      if (code === 'timeout') return 'Nebula took too long to answer. It may be mid-render — retrying…';
    }
    return error.message;
  }
  return 'Something unexpected went wrong.';
}

function jobTitle(job: NebulaJob): string {
  return job.title || job.workflow || job.id;
}

function stateTone(state: string): 'ok' | 'warn' | 'err' | 'info' | 'slate' {
  switch (state) {
    case 'success':
    case 'done':
      return 'ok';
    case 'cancelled':
    case 'waiting':
      return 'warn';
    case 'error':
    case 'failed':
      return 'err';
    case 'running':
      return 'info';
    default:
      return 'slate';
  }
}

function formatTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Nebula's jobs-note line, verbatim logic. */
function jobsNote(jobs: JobsResponse): string {
  if (jobs.waiting)
    return jobs.waiting + ' waiting for a free backend · ' + (jobs.active.length ? jobs.active.length + ' active' : '');
  if (jobs.busy) return 'ComfyUI is mid-render and not answering — showing what is known';
  return jobs.active.length ? jobs.active.length + ' active' : 'nothing running';
}

export function JobsView({ conn }: JobsViewProps) {
  const [jobs, setJobs] = useState<JobsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getJobs(20, {
        baseUrl: conn.baseUrl,
        passphrase: conn.passphrase,
        signal: ctrl.current?.signal ?? null,
      });
      setJobs(res);
      setError(null);
    } catch (err) {
      // Transient poll failures keep the last good list on screen and note
      // the problem honestly, instead of blanking the queue mid-render.
      setError(friendlyError(err));
    }
  }, [conn.baseUrl, conn.passphrase]);

  useEffect(() => {
    ctrl.current = new AbortController();
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      ctrl.current?.abort();
    };
  }, [load]);

  const doCancel = async (job: NebulaJob) => {
    setCancelling(job.id);
    try {
      await cancelJob(job.id, {
        baseUrl: conn.baseUrl,
        passphrase: conn.passphrase,
        backend: job.backend || 'nvidia',
      });
      await load();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCancelling(null);
    }
  };

  if (!jobs && !error) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label="Loading jobs" />
      </div>
    );
  }

  const active = jobs?.active ?? [];
  const recent = jobs?.recent ?? [];

  if (active.length === 0 && recent.length === 0) {
    return (
      <>
        {error && <ErrorBox message={error} />}
        <EmptyState
          mark="◌"
          title="No jobs yet"
          text="Runs you submit from the New tab appear here with live status."
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-secondary" role="status">
        {jobs ? jobsNote(jobs) : ''}
      </p>

      {error && <ErrorBox message={error} />}

      {active.length > 0 && (
        <section aria-label="Active jobs">
          <h2 className="text-label mb-2">Active ({active.length})</h2>
          <div className="flex flex-col gap-2">
            {active.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                conn={conn}
                expanded={expanded === job.id}
                onToggleExpanded={() => setExpanded(expanded === job.id ? null : job.id)}
                onCancel={() => doCancel(job)}
                cancelling={cancelling === job.id}
              />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-label="Recent jobs">
          <h2 className="text-label mb-2">Recent</h2>
          <div className="flex flex-col gap-2">
            {recent.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                conn={conn}
                expanded={expanded === job.id}
                onToggleExpanded={() => setExpanded(expanded === job.id ? null : job.id)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function JobCard({
  job,
  conn,
  expanded,
  onToggleExpanded,
  onCancel,
  cancelling,
}: {
  job: NebulaJob;
  conn: CreateConnection;
  expanded: boolean;
  onToggleExpanded: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const progress = job.progress;
  const pct = progress ? Math.round((progress.value / progress.max) * 100) : null;
  const meta = [job.workflow, job.user, job.device, formatTime(job.queuedAt)]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{jobTitle(job)}</p>
          {meta && <p className="text-xs text-text-secondary">{meta}</p>}
        </div>
        <Badge tone={stateTone(job.state)} size="sm">
          {job.state}
        </Badge>
      </div>

      {onCancel && (
        progress ? (
          <div className="mt-2 flex flex-col gap-1">
            <ProgressBar
              value={(progress.value / progress.max) * 100}
              label={'Job progress' + (progress.phase ? ': ' + progress.phase : '')}
            />
            <p className="text-xs text-text-secondary">
              {[progress.phase, pct != null ? pct + '%' : null, `step ${progress.value}/${progress.max}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <ProgressBar label="Job progress (no step data yet)" />
          </div>
        )
      )}

      {job.outputs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Output thumbnails">
          {job.outputs.map((out, i) => (
            <AuthenticatedImage
              key={out}
              baseUrl={conn.baseUrl}
              passphrase={conn.passphrase}
              path={out}
              kind="thumb"
              size={176}
              alt={`Output ${i + 1} of ${jobTitle(job)}`}
              className="h-16 w-16 rounded object-cover"
            />
          ))}
        </div>
      )}

      {onCancel ? (
        <QButton
          type="button"
          color="primary-destructive"
          onClick={onCancel}
          isDisabled={cancelling}
          isLoading={cancelling}
          showTextWhileLoading
          className="mt-2 w-full"
        >
          Cancel
        </QButton>
      ) : (
        job.outputs.length > 0 && (
          <QButton
            type="button"
            color="tertiary"
            onClick={onToggleExpanded}
            aria-expanded={expanded}
            className="mt-2 w-full"
          >
            {expanded ? 'Hide outputs' : `Outputs (${job.outputs.length})`}
          </QButton>
        )
      )}

      {expanded && !onCancel && (
        <div className="mt-2 flex flex-col gap-2">
          {job.outputs.map((out) => (
            <AuthenticatedImage
              key={out}
              baseUrl={conn.baseUrl}
              passphrase={conn.passphrase}
              path={out}
              kind="file"
              alt={'Output of ' + jobTitle(job)}
              className="w-full rounded-lg"
            />
          ))}
        </div>
      )}
    </article>
  );
}
