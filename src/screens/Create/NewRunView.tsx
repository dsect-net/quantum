/**
 * Create → New: pick a Nebula workflow, fill the run form, submit.
 *
 * The form is driven by GET /api/workflow/{name} ("the editable settings
 * for a workflow, as the run would actually see them"): basic params render
 * up front, advanced ones behind a toggle, hidden ones are never rendered
 * (the server keeps its own values for those — omitting them is correct,
 * not a gap). Image inputs get an honest note instead of a fake control:
 * photo upload is not in Quantum yet.
 *
 * Submit posts overrides [{node, key, value}] to POST /api/run. A prompt id
 * hands off to the Jobs view; a deferred run (backend busy) is reported
 * verbatim from the server and watched from Jobs instead of polled here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { TextField, TextArea, SelectField, Checkbox } from '@dsect/ui/components/forms';
import {
  NebulaApiError,
  getWorkflow,
  listWorkflows,
  runWorkflow,
  type JobOverride,
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
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Workflow list
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    listWorkflows({ baseUrl: conn.baseUrl, passphrase: conn.passphrase, signal: ctrl.signal })
      .then((list) => {
        if (!live) return;
        setWorkflows(list);
        setWorkflowsError(null);
        if (list.length > 0 && !selected) setSelected(list[0].name);
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

  // Workflow detail → form defaults
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const ctrl = new AbortController();
    setLoadingDetail(true);
    setDetail(null);
    setDetailError(null);
    setShowAdvanced(false);
    getWorkflow(selected, { baseUrl: conn.baseUrl, passphrase: conn.passphrase, signal: ctrl.signal })
      .then((d) => {
        if (!live) return;
        setDetail(d);
        const defaults: Record<string, unknown> = {};
        for (const p of d.params) {
          if (p.level !== 'hidden' && p.kind !== 'unsupported' && p.kind !== 'image') {
            defaults[paramId(p)] = p.value;
          }
        }
        setValues(defaults);
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
    () => (detail?.params ?? []).filter((p) => p.level === 'basic'),
    [detail],
  );
  const advancedParams = useMemo(
    () => (detail?.params ?? []).filter((p) => p.level === 'advanced'),
    [detail],
  );
  const imageParams = useMemo(
    () => (detail?.params ?? []).filter((p) => p.level !== 'hidden' && p.kind === 'image'),
    [detail],
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

  const groups = groupByKind(workflows);

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Workflow"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={submitting}
      >
        {groups.map((g) => (
          <optgroup key={g.kind} label={g.kind}>
            {g.items.map((w) => (
              <option key={w.name} value={w.name}>
                {w.short}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>

      {loadingDetail && (
        <div className="flex items-center justify-center py-10">
          <Spinner label="Loading run form" />
        </div>
      )}
      {detailError && <ErrorBox message={detailError} />}

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
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              aria-expanded={showAdvanced}
              className="min-h-[44px] self-start rounded-lg px-3 text-sm font-medium text-text-brand-secondary"
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced ({advancedParams.length})
            </button>
          )}
          {showAdvanced &&
            advancedParams.map((p) => (
              <ParamField key={paramId(p)} param={p} value={values[paramId(p)]} onChange={(v) => setValue(p, v)} disabled={submitting} />
            ))}

          {notice && (
            <div className="rounded-lg border p-3" role="status">
              <p className="text-sm">{notice}</p>
            </div>
          )}
          {submitError && <ErrorBox message={submitError} />}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="btn btn-primary min-h-[48px] rounded-xl font-semibold disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Generate'}
          </button>
        </>
      )}
    </div>
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
        <button
          type="button"
          onClick={onRetry}
          className="min-h-[44px] self-start rounded-lg px-3 text-sm font-medium text-text-brand-secondary"
        >
          Retry
        </button>
      )}
    </div>
  );
}
