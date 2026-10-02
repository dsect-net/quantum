/**
 * Create → New: Nebula's "Run a workflow" card, rebuilt for Quantum.
 *
 * The form is driven by GET /api/workflow/{name} ("the editable settings
 * for a workflow, as the run would actually see them"): basic params render
 * up front, advanced ones behind the "Advanced options" disclosure, hidden
 * ones are never rendered (the server keeps its own values for those —
 * omitting them is correct, not a gap). Image inputs get an honest note
 * instead of a fake control: photo upload is not in Quantum yet.
 *
 * Mirrors Nebula's own run form where the client allows it:
 *  - a "Type of generation" kind tablist with per-kind counts (Nebula's
 *    run form asks the TYPE first, then the workflow — never one flat
 *    list), with the remembered kind/workflow restored like the PWA;
 *  - the 3D rigging hint (T-pose/A-pose) that Nebula shows at generation
 *    time rather than rig time;
 *  - an "Advanced options" disclosure that counts changed settings, offers
 *    "Reset to defaults", and filters the settings list;
 *  - a "Queue run" submit and a "Recent runs" card with a Refresh button.
 *
 * Two Nebula run-form sections are deliberately absent: quality presets
 * and compute-backend selection. Both need /api/presets and /api/backends,
 * which the (untouchable) API client does not expose — a preset picker
 * with no data would be a fake control. The run posts without a backend
 * choice; the client defaults to the server's primary backend.
 *
 * Submit posts overrides [{node, key, value}] to POST /api/run. A prompt id
 * hands off to the Jobs view; a deferred run (backend busy) is reported
 * verbatim from the server and watched from Jobs instead of polled here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { TextField, TextArea, SelectField, Checkbox } from '@dsect/ui/components/forms';
import { Panel, PanelHead, PanelBody } from '@dsect/ui/components/surfaces';
import { Tabs, type TabItem } from '@dsect/ui/components/overlays';
import { SearchInput } from '@dsect/ui/components/navigation';
import { QButton } from '../../lib/untitled';
import {
  NebulaApiError,
  getJobs,
  getWorkflow,
  listWorkflows,
  runWorkflow,
  type JobOverride,
  type NebulaJob,
  type WorkflowDetail,
  type WorkflowParam,
  type WorkflowSummary,
} from '../../api/nebula';

export interface CreateConnection {
  baseUrl: string;
  passphrase: string;
}

export interface NewRunViewProps {
  conn: CreateConnection;
  onSubmitted: () => void;
}

/** localStorage keys for the remembered kind/workflow (mirrors Nebula's cc_kind/cc_wf). */
const KIND_KEY = 'quantum.create.kind';
const WORKFLOW_KEY = 'quantum.create.workflow';

/** Nebula's own generation-time hint for the 3D kind, shown at run time. */
const KIND_HINTS: Record<string, string> = {
  '3D': 'For a model you intend to rig, use a reference image in a T-pose or A-pose — arms and legs clear of the body. Arms hanging against the torso fuse to it in the mesh, and no rigger can separate them afterwards.',
};

function paramId(p: WorkflowParam): string {
  return p.node + ':' + p.key;
}

function isLongText(p: WorkflowParam): boolean {
  const label = p.label.toLowerCase();
  const value = String(p.value ?? '');
  return (
    label.includes('prompt') ||
    label.includes('idea') ||
    label.includes('description') ||
    value.length > 80
  );
}

/** Value equality for the "changed" count: number fields store strings in state. */
function paramEqual(p: WorkflowParam, a: unknown, b: unknown): boolean {
  if (p.kind === 'int' || p.kind === 'float') {
    const na = typeof a === 'number' ? a : Number(String(a ?? ''));
    const nb = typeof b === 'number' ? b : Number(String(b ?? ''));
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a ?? '') === String(b ?? '');
    return na === nb;
  }
  if (p.kind === 'bool') return (a === true) === (b === true);
  return String(a ?? '') === String(b ?? '');
}

function friendlyError(error: unknown): string {
  if (error instanceof NebulaApiError) {
    switch (error.code) {
      case 'auth':
        return 'Nebula refused the credentials. If you are off the tailnet, check the Nebula passphrase in Connection settings (More tab).';
      case 'rejected':
        return error.message;
      case 'network':
        return 'Could not reach Nebula. Check the base URL in Connection settings and that the service is up.';
      case 'timeout':
        return 'Nebula took too long to answer. It may be mid-render — try again in a moment.';
      case 'aborted':
        return 'The request was stopped.';
      default:
        return error.message;
    }
  }
  return 'Something unexpected went wrong.';
}

function groupByKind(workflows: WorkflowSummary[]): { kind: string; items: WorkflowSummary[] }[] {
  const groups = new Map<string, WorkflowSummary[]>();
  for (const w of workflows) {
    const list = groups.get(w.kind) ?? [];
    list.push(w);
    groups.set(w.kind, list);
  }
  return [...groups.entries()]
    .map(([kind, items]) => ({ kind, items: items.sort((a, b) => a.order - b.order || a.short.localeCompare(b.short)) }))
    .sort((a, b) => (a.items[0]?.order ?? 9) - (b.items[0]?.order ?? 9));
}

export function NewRunView({ conn, onSubmitted }: NewRunViewProps) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advFilter, setAdvFilter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo(() => groupByKind(workflows ?? []), [workflows]);

  // Workflow list (restores the remembered kind/workflow like Nebula does).
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    listWorkflows({ baseUrl: conn.baseUrl, passphrase: conn.passphrase, signal: ctrl.signal })
      .then((list) => {
        if (!live) return;
        setWorkflows(list);
        setWorkflowsError(null);
        if (list.length === 0) return;
        const gs = groupByKind(list);
        const rememberedWf = localStorage.getItem(WORKFLOW_KEY);
        const ofRemembered = list.find((w) => w.name === rememberedWf);
        const rememberedKind = localStorage.getItem(KIND_KEY);
        const nextKind =
          (ofRemembered && ofRemembered.kind) ||
          (rememberedKind && gs.some((g) => g.kind === rememberedKind) ? rememberedKind : gs[0]?.kind) ||
          null;
        setKind((prev) => prev ?? nextKind);
        const firstOfKind = gs.find((g) => g.kind === nextKind)?.items[0];
        setSelected((prev) =>
          prev ||
          (ofRemembered && ofRemembered.kind === nextKind ? ofRemembered.name : '') ||
          firstOfKind?.name ||
          list[0].name,
        );
      })
      .catch((error) => {
        if (live) setWorkflowsError(friendlyError(error));
      });
    return () => {
      live = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.baseUrl, conn.passphrase]);

  const selectKind = (next: string) => {
    if (next === kind) return;
    localStorage.setItem(KIND_KEY, next);
    setKind(next);
    const first = groups.find((g) => g.kind === next)?.items[0];
    if (first) setSelected(first.name);
  };

  const selectWorkflow = (name: string) => {
    localStorage.setItem(WORKFLOW_KEY, name);
    setSelected(name);
  };

  // Workflow detail → form defaults.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const ctrl = new AbortController();
    setLoadingDetail(true);
    setDetail(null);
    setDetailError(null);
    setShowAdvanced(false);
    setAdvFilter('');
    getWorkflow(selected, { baseUrl: conn.baseUrl, passphrase: conn.passphrase, signal: ctrl.signal })
      .then((d) => {
        if (!live) return;
        setDetail(d);
        const initial: Record<string, unknown> = {};
        for (const p of d.params) {
          if (p.level !== 'hidden' && p.kind !== 'unsupported' && p.kind !== 'image') {
            initial[paramId(p)] = p.value;
          }
        }
        setDefaults(initial);
        setValues(initial);
      })
      .catch((error) => {
        if (live) setDetailError(friendlyError(error));
      })
      .finally(() => {
        if (live) setLoadingDetail(false);
      });
    return () => {
      live = false;
      ctrl.abort();
    };
  }, [selected, conn.baseUrl, conn.passphrase]);

  const setValue = (p: WorkflowParam, value: unknown) => {
    setValues((prev) => ({ ...prev, [paramId(p)]: value }));
  };

  const basicParams = useMemo(
    () => (detail?.params ?? []).filter((p) => p.level === 'basic' && p.kind !== 'image' && p.kind !== 'unsupported'),
    [detail],
  );
  const advancedParams = useMemo(
    () => (detail?.params ?? []).filter((p) => p.level === 'advanced' && p.kind !== 'image' && p.kind !== 'unsupported'),
    [detail],
  );
  const imageParams = useMemo(
    () => (detail?.params ?? []).filter((p) => p.level !== 'hidden' && p.kind === 'image'),
    [detail],
  );
  const filteredAdvanced = useMemo(() => {
    const q = advFilter.trim().toLowerCase();
    if (!q) return advancedParams;
    return advancedParams.filter((p) =>
      (p.label + ' ' + p.key + ' ' + p.note).toLowerCase().includes(q),
    );
  }, [advancedParams, advFilter]);
  const changedAdvanced = useMemo(
    () => advancedParams.filter((p) => !paramEqual(p, values[paramId(p)], defaults[paramId(p)])).length,
    [advancedParams, values, defaults],
  );

  const buildOverrides = (): JobOverride[] => {
    const overrides: JobOverride[] = [];
    for (const p of detail?.params ?? []) {
      if (p.level === 'hidden' || p.kind === 'image' || p.kind === 'unsupported') continue;
      const raw = values[paramId(p)];
      let value = raw;
      if (p.kind === 'int' || p.kind === 'float') {
        const n = typeof raw === 'number' ? raw : Number(String(raw ?? ''));
        if (!Number.isFinite(n)) continue; // blank/invalid → keep the server's value
        value = p.kind === 'int' ? Math.round(n) : n;
      }
      if (p.kind === 'bool') value = value === true;
      overrides.push({ node: p.node, key: p.key, value });
    }
    return overrides;
  };

  const submit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const res = await runWorkflow({
        baseUrl: conn.baseUrl,
        passphrase: conn.passphrase,
        workflow: selected,
        overrides: buildOverrides(),
        randomizeSeed: true,
      });
      if (res.deferred) {
        setNotice(res.message + ' Watch the Jobs tab — it will appear there when it starts.');
      }
      onSubmitted();
    } catch (error) {
      setSubmitError(friendlyError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (!workflows && !workflowsError) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label="Loading workflows" />
      </div>
    );
  }
  if (workflowsError) {
    return <ErrorBox message={workflowsError} onRetry={() => window.location.reload()} />;
  }
  if (!workflows || workflows.length === 0) {
    return (
      <EmptyState
        mark="◌"
        title="No workflows"
        text="Nebula answered but listed no workflows. Add a workflow JSON on the server and try again."
      />
    );
  }

  const kindHint = kind ? KIND_HINTS[kind] : undefined;
  const kindTabs: TabItem[] = groups.map((g) => ({
    id: g.kind,
    label: g.kind,
    badge: <Badge size="sm" tone="slate">{g.items.length}</Badge>,
    panel: null,
  }));
  const kindItems = groups.find((g) => g.kind === kind)?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHead className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Run a workflow</h2>
          <Badge size="sm" tone="slate">
            {workflows.length} saved
          </Badge>
        </PanelHead>
        <PanelBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Tabs
              tabs={kindTabs}
              label="Type of generation"
              value={kind ?? undefined}
              onChange={selectKind}
            />
            {kindHint && (
              <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-text-secondary">
                {kindHint}
              </p>
            )}
            <SelectField
              label="Workflow"
              value={selected}
              onChange={(e) => selectWorkflow(e.target.value)}
              disabled={submitting}
            >
              {kindItems.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.short}
                </option>
              ))}
            </SelectField>
          </div>

          {loadingDetail && (
            <div className="flex items-center justify-center py-10">
              <Spinner label="Loading run form" />
            </div>
          )}
          {detailError && <ErrorBox message={detailError} onRetry={() => selectWorkflow(selected)} />}

          {detail && (
            <>
              {imageParams.length > 0 && (
                <div className="rounded-lg border border-dashed p-3" role="note">
                  <p className="text-sm text-text-secondary">
                    This workflow takes an image input
                    {imageParams.length === 1 ? '' : 's'} (
                    {imageParams.map((p) => p.label).join(', ')}). Photo upload isn't
                    in Quantum yet — run this one from the Nebula PWA.
                  </p>
                </div>
              )}

              {basicParams.map((p) => (
                <ParamField key={paramId(p)} param={p} value={values[paramId(p)]} onChange={(v) => setValue(p, v)} disabled={submitting} />
              ))}

              {advancedParams.length > 0 && (
                <div className="flex flex-col gap-2">
                  <QButton
                    type="button"
                    color="secondary"
                    onClick={() => setShowAdvanced((s) => !s)}
                    aria-expanded={showAdvanced}
                    className="self-start"
                  >
                    <span aria-hidden="true">{showAdvanced ? '▾' : '›'} </span>
                    Advanced options
                    {changedAdvanced > 0 && ` (${changedAdvanced} changed)`}
                  </QButton>
                  {showAdvanced && (
                    <>
                      <div className="flex items-center gap-2">
                        <SearchInput
                          placeholder="Filter settings"
                          aria-label="Filter advanced settings"
                          value={advFilter}
                          onChange={(e) => setAdvFilter(e.target.value)}
                          className="input min-h-[44px] flex-1"
                        />
                        <QButton
                          type="button"
                          color="tertiary"
                          onClick={() => setValues({ ...defaults })}
                          className="shrink-0"
                        >
                          Reset to defaults
                        </QButton>
                      </div>
                      {filteredAdvanced.length === 0 ? (
                        <p className="text-sm text-text-secondary">
                          No settings match that filter.
                        </p>
                      ) : (
                        filteredAdvanced.map((p) => (
                          <ParamField key={paramId(p)} param={p} value={values[paramId(p)]} onChange={(v) => setValue(p, v)} disabled={submitting} />
                        ))
                      )}
                    </>
                  )}
                </div>
              )}

              {notice && (
                <div className="rounded-lg border p-3" role="status">
                  <p className="text-sm">{notice}</p>
                </div>
              )}
              {submitError && <ErrorBox message={submitError} />}

              <QButton
                type="button"
                color="primary"
                onClick={submit}
                isDisabled={submitting}
                isLoading={submitting}
                showTextWhileLoading
                className="min-h-[48px] w-full"
              >
                Queue run
              </QButton>
            </>
          )}
        </PanelBody>
      </Panel>

      <RecentRuns conn={conn} />
    </div>
  );
}

/**
 * "Recent runs" card — Nebula's run-log card. The client has no /api/history
 * endpoint, so the log is fed from the recent end of /api/jobs instead: the
 * same terminal state and output count Nebula's log lines show ("ok
 * ab12cd34 · 2 file(s)").
 */
function RecentRuns({ conn }: { conn: CreateConnection }) {
  const [recent, setRecent] = useState<NebulaJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getJobs(20, { baseUrl: conn.baseUrl, passphrase: conn.passphrase });
      setRecent(res.recent);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [conn.baseUrl, conn.passphrase]);

  useEffect(() => {
    const ctrl = new AbortController();
    load();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.baseUrl, conn.passphrase]);

  return (
    <Panel>
      <PanelHead className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Recent runs</h2>
        <QButton type="button" color="secondary" onClick={load} isDisabled={loading}>
          Refresh
        </QButton>
      </PanelHead>
      <PanelBody>
        {loading && recent === null ? (
          <div className="flex items-center justify-center py-8">
            <Spinner label="Loading recent runs" />
          </div>
        ) : error ? (
          <ErrorBox message={error} onRetry={load} />
        ) : !recent || recent.length === 0 ? (
          <p className="text-sm text-text-secondary">No runs recorded yet.</p>
        ) : (
          <div role="log" aria-label="Recent runs" className="flex flex-col gap-1.5">
            {recent.map((job) => {
              const ok = job.state === 'success' || job.state === 'done';
              return (
                <div key={job.id} className="flex items-center gap-2 text-sm">
                  <Badge tone={ok ? 'ok' : job.state === 'cancelled' ? 'warn' : 'err'} size="sm">
                    {ok ? 'ok' : job.state}
                  </Badge>
                  <span className="font-mono text-xs text-text-secondary">{job.id.slice(0, 8)}</span>
                  <span className="text-xs text-text-secondary">
                    · {job.outputs.length} file{job.outputs.length === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function ParamField({
  param,
  value,
  onChange,
  disabled,
}: {
  param: WorkflowParam;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const hint = param.note || undefined;

  if (param.kind === 'unsupported') return null;
  if (param.kind === 'image') return null;

  if (param.kind === 'bool') {
    return (
      <div className="flex flex-col gap-1">
        <Checkbox
          label={param.label}
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        {hint && <p className="text-small">{hint}</p>}
      </div>
    );
  }
  if (param.kind === 'choice' && param.choices) {
    return (
      <SelectField
        label={param.label}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {param.choices.map((c) => (
          <option key={c} value={c} disabled={param.unavailable.includes(c)}>
            {c}
            {param.unavailable.includes(c) ? ' (not on this hardware)' : ''}
          </option>
        ))}
      </SelectField>
    );
  }
  if (param.kind === 'int' || param.kind === 'float') {
    return (
      <TextField
        label={param.label}
        hint={hint ?? rangeHint(param)}
        type="number"
        inputMode="decimal"
        value={value == null ? '' : String(value)}
        min={param.min ?? undefined}
        max={param.max ?? undefined}
        step={param.step ?? (param.kind === 'int' ? 1 : 'any')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }
  // text
  if (isLongText(param)) {
    return (
      <TextArea
        label={param.label}
        hint={hint}
        rows={4}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    );
  }
  return (
    <TextField
      label={param.label}
      hint={hint}
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

function rangeHint(p: WorkflowParam): string | undefined {
  if (p.min == null && p.max == null) return undefined;
  return 'Range: ' + (p.min ?? '…') + ' – ' + (p.max ?? '…');
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--red)' }} role="alert">
      <div className="flex items-start gap-2">
        <Badge tone="err" size="sm">
          Error
        </Badge>
        <p className="text-sm">{message}</p>
      </div>
      {onRetry && (
        <QButton type="button" color="tertiary" onClick={onRetry} className="min-h-[44px] self-start">
          Retry
        </QButton>
      )}
    </div>
  );
}
