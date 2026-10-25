import { useEffect, useMemo, useState } from 'react';
import { AppShell, AppBar } from '@dsect/ui/components/app';
import { STALE_THRESHOLD_DAYS, STUCK_WIP_DAYS, countStale, countStuckWip, daysSinceActivity, isStale, isStuckWip } from './lib/stale';
import { Card, Panel, PanelBody } from '@dsect/ui/components/surfaces';
import {
  Badge,
  EmptyState,
  ProgressBar,
  Skeleton,
  Toaster,
  type ToastData,
} from '@dsect/ui/components/feedback';
import { FilterBar, SearchInput, FilterSelect } from '@dsect/ui/components/navigation';
import { Button } from '@dsect/ui/components/buttons';
import { loadBoard, fetchItem, updateItem } from './api';
import {
  ALL_STATUSES,
  COLUMNS,
  DONE_SHOWN,
  PRIO_COLORS,
  PRIORITIES,
  STATUS_LABELS,
  type BoardItem,
  type ItemDetail,
  type Priority,
  type Status,
} from './types';

const ET = 'America/New_York';

function etHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: ET }).format(
      new Date(),
    ),
  );
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ts
    : d.toLocaleString('en-US', { timeZone: ET, dateStyle: 'medium', timeStyle: 'short' });
}

interface EditForm {
  title: string;
  status: Status;
  priority: Priority;
  assignee: string;
  due_at: string;
  points: string;
  body: string;
}

export default function App() {
  const [items, setItems] = useState<BoardItem[] | null>(null);
  const [projects, setProjects] = useState<
    { id: string; title: string; slug: string; member_ids: string[] }[]
  >([]);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // TRK-0204 (Pixel): stale filter, collapsible Cancelled column, phone column tabs.
  const [staleOnly, setStaleOnly] = useState(false);
  const [stuckOnly, setStuckOnly] = useState(false);
  const [showCancelled, setShowCancelled] = useState(
    () => localStorage.getItem('tb-show-cancelled') === '1',
  );
  const [mobileCol, setMobileCol] = useState<Status>('in_progress');
  const [reloadKey, setReloadKey] = useState(0);

  const [projectSlug, setProjectSlug] = useState(
    () => new URLSearchParams(window.location.search).get('project') ?? '',
  );
  const [filter, setFilter] = useState(() => sessionStorage.getItem('tb-filter') ?? '');

  const [sheetId, setSheetId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverStatus, setHoverStatus] = useState<Status | null>(null);

  const pushToast = (t: Omit<ToastData, 'id'>) => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  };

  useEffect(() => {
    let live = true;
    loadBoard()
      .then((data) => {
        if (!live) return;
        setItems(data.items);
        setProjects(data.projects);
        setGeneratedAt(data.generated_at);
        setLoadErr(null);
      })
      .catch((err: Error) => {
        if (live) setLoadErr(err.message);
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    sessionStorage.setItem('tb-filter', filter);
  }, [filter]);

  const activeProject = useMemo(
    () => projects.find((p) => p.slug === projectSlug) ?? null,
    [projects, projectSlug],
  );

  const scoped = useMemo(() => {
    if (!items) return [];
    if (!activeProject) return items;
    const members = new Set(activeProject.member_ids);
    return items.filter((i) => members.has(i.id));
  }, [items, activeProject]);

  const counts = useMemo(
    () => ({
      open: scoped.filter((i) => i.status !== 'done' && i.status !== 'cancelled').length,
      done: scoped.filter((i) => i.status === 'done').length,
      cancelled: scoped.filter((i) => i.status === 'cancelled').length,
    }),
    [scoped],
  );

  // Canonical stale count: whole board, all owners (not project-scoped).
  const staleCount = useMemo(() => countStale(items ?? []), [items]);
  const stuckCount = useMemo(() => countStuckWip(items ?? []), [items]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = staleOnly
      ? scoped.filter((i) => isStale(i))
      : stuckOnly
        ? scoped.filter((i) => isStuckWip(i))
        : scoped;
    if (!q) return base;
    return base.filter((i) =>
      [i.id, i.kind, i.title, i.assignee].some((v) => v.toLowerCase().includes(q)),
    );
  }, [scoped, filter, staleOnly, stuckOnly]);

  useEffect(() => {
    localStorage.setItem('tb-show-cancelled', showCancelled ? '1' : '0');
  }, [showCancelled]);

  const columns = showCancelled
    ? [...COLUMNS, { status: 'cancelled' as Status, label: 'Cancelled' }]
    : COLUMNS;

  const hero = useMemo(() => {
    const total = scoped.reduce((s, i) => s + (i.points ?? 0), 0);
    const done = scoped
      .filter((i) => i.status === 'done')
      .reduce((s, i) => s + (i.points ?? 0), 0);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const week = scoped
      .filter((i) => i.status === 'done' && new Date(i.updated_at).getTime() >= weekAgo)
      .reduce((s, i) => s + (i.points ?? 0), 0);
    return { total, done, week, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [scoped]);

  const selectProject = (slug: string) => {
    setProjectSlug(slug);
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('project', slug);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url);
  };

  const mergeItem = (fresh: BoardItem) =>
    setItems((prev) => (prev ? prev.map((i) => (i.id === fresh.id ? { ...i, ...fresh } : i)) : prev));

  const openItem = (id: string) => {
    setSheetId(id);
    setDetail(null);
    setForm(null);
    setSaveMsg(null);
    fetchItem(id)
      .then((d) => {
        setDetail(d);
        setForm({
          title: d.item.title,
          status: d.item.status,
          priority: d.item.priority,
          assignee: d.item.assignee,
          due_at: d.item.due_at ? d.item.due_at.slice(0, 10) : '',
          points: d.item.points === null ? '' : String(d.item.points),
          body: d.item.body,
        });
      })
      .catch((err: Error) => {
        pushToast({ tone: 'err', title: `Could not load ${id}`, text: err.message });
        setSheetId(null);
      });
  };

  const save = () => {
    if (!sheetId || !form) return;
    setSaving(true);
    setSaveMsg(null);
    updateItem(sheetId, {
      title: form.title,
      body: form.body,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee,
      due_at: form.due_at,
      points: form.points.trim() === '' ? null : Number(form.points),
    })
      .then((fresh) => {
        mergeItem(fresh);
        setDetail((d) => (d ? { ...d, item: fresh } : d));
        setSaveMsg({ kind: 'ok', text: `Saved ${fresh.id} — the board reads server truth.` });
        pushToast({ tone: 'ok', title: `Saved ${fresh.id}` });
      })
      .catch((err: Error) => {
        setSaveMsg({ kind: 'err', text: err.message });
        pushToast({ tone: 'err', title: 'Save failed', text: err.message });
      })
      .finally(() => setSaving(false));
  };

  const moveItem = (id: string, to: Status) => {
    if (!items) return;
    const current = items.find((i) => i.id === id);
    if (!current || current.status === to) return;
    const prev = items;
    setItems(items.map((i) => (i.id === id ? { ...i, status: to } : i)));
    updateItem(id, { status: to })
      .then((fresh) => mergeItem(fresh))
      .catch((err: Error) => {
        setItems(prev);
        pushToast({ tone: 'err', title: 'Could not save that move — card put back.', text: err.message });
      });
  };

  const hour = etHour();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: ET,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="tb-app">
      <AppShell
        appBar={
          <AppBar
            title="Tracker Board"
            subtitle={`${counts.open} open · ${counts.done} done · ${counts.cancelled} cancelled${
              activeProject ? ` · Project: ${activeProject.title}` : ''
            }`}
            actions={<Badge tone="ok" dot>live</Badge>}
          />
        }
      >
        <main className="tb-main">
          <Panel>
            <PanelBody>
              <div className="tb-hero">
                <div>
                  <h2 className="tb-hero__greet">{greeting}.</h2>
                  <p className="tb-hero__sub">
                    {today} · snapshot {generatedAt ? fmtTs(generatedAt) : '…'}
                  </p>
                </div>
                <div className="tb-hero__progress">
                  <div className="tb-hero__progress-label">
                    <span>Board points done</span>
                    <span>
                      {hero.done}/{hero.total} pts · {hero.week} pts this week
                    </span>
                  </div>
                  <ProgressBar value={hero.pct} label="Board points done" />
                </div>
                <span className="tb-hero__doodle" aria-hidden="true">
                  small steps, big results
                </span>
              </div>
            </PanelBody>
          </Panel>

          <FilterBar>
            <label htmlFor="tb-project">Project</label>
            <FilterSelect
              id="tb-project"
              value={projectSlug}
              onChange={(e) => selectProject(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.title} ({p.member_ids.length})
                </option>
              ))}
            </FilterSelect>
            <SearchInput
              className="tb-search"
              placeholder="Filter cards…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter cards"
            />
            <Button
              variant={staleOnly ? 'primary' : 'ghost'}
              aria-pressed={staleOnly}
              onClick={() => {
                setStaleOnly((v) => !v);
                setStuckOnly(false);
              }}
            >
              Stale only ({staleCount})
            </Button>
            <Button
              className="tb-stuck-btn"
              variant={stuckOnly ? 'primary' : 'ghost'}
              aria-pressed={stuckOnly}
              onClick={() => {
                setStuckOnly((v) => !v);
                setStaleOnly(false);
              }}
            >
              Stuck WIP ({stuckCount})
            </Button>
            <Button
              variant="ghost"
              aria-pressed={showCancelled}
              onClick={() => setShowCancelled((v) => !v)}
            >
              {showCancelled ? 'Hide' : 'Show'} cancelled
            </Button>
          </FilterBar>

          {loadErr ? (
            <EmptyState
              title="Board snapshot unavailable"
              text={loadErr}
              actions={
                <Button variant="primary" onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </Button>
              }
            />
          ) : items === null ? (
            <div aria-busy="true">
              <Skeleton style={{ height: 28, marginBottom: 12 }} />
              <Skeleton style={{ height: 120, marginBottom: 12 }} />
              <Skeleton style={{ height: 120 }} />
            </div>
          ) : (
            <>
            <nav className="tb-coltabs" aria-label="Board columns">
              {columns.map(({ status, label }) => (
                <button
                  key={status}
                  type="button"
                  className={mobileCol === status ? 'on' : ''}
                  aria-pressed={mobileCol === status}
                  onClick={() => setMobileCol(status)}
                >
                  {label.replace(' (recent)', '')}{' '}
                  <span>{visible.filter((i) => i.status === status).length}</span>
                </button>
              ))}
            </nav>
            <div className="tb-board">
              {columns.map(({ status, label }) => {
                const colItems = visible.filter((i) => i.status === status);
                const shown = status === 'done' ? colItems.slice(0, DONE_SHOWN) : colItems;
                return (
                  <section
                    key={status}
                    className={`tb-col${hoverStatus === status && dragId ? ' drop-hover' : ''}${mobileCol === status ? ' is-mobile-active' : ''}`}
                    data-status={status}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setHoverStatus(status);
                    }}
                    onDragLeave={() => setHoverStatus((s) => (s === status ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain') || dragId;
                      setHoverStatus(null);
                      setDragId(null);
                      if (id) moveItem(id, status);
                    }}
                  >
                    <h3 className="tb-col__head">
                      {label} <span className="tb-col__count">{colItems.length}</span>
                    </h3>
                    {shown.map((item) => (
                      <Card
                        key={item.id}
                        className="tb-card"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', item.id);
                          setDragId(item.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setHoverStatus(null);
                        }}
                        onClick={() => openItem(item.id)}
                      >
                        <div className="tb-card__top">
                          <span className="tb-card__id">{item.id}</span>
                          <span className="tb-card__kind">{item.kind}</span>
                          {isStale(item) && (
                            <span className="tb-card__stale" title={`No activity in over ${STALE_THRESHOLD_DAYS} days`}>
                              stale {daysSinceActivity(item)}d
                            </span>
                          )}
                          {!isStale(item) && isStuckWip(item) && (
                            <span className="tb-card__stuck" title={`In progress/review with no activity in over ${STUCK_WIP_DAYS} days`}>
                              stuck {daysSinceActivity(item)}d
                            </span>
                          )}
                        </div>
                        <div className="tb-card__title">{item.title}</div>
                        <div className="tb-card__meta">
                          <span
                            className="tb-card__dot"
                            style={{ background: PRIO_COLORS[item.priority] }}
                          />
                          <span>{item.priority}</span>
                          {item.points ? <span>{item.points} pts</span> : null}
                          {item.assignee ? <span>{item.assignee}</span> : null}
                          {item.due_at ? (
                            <span className="tb-card__due">due {item.due_at.slice(0, 10)}</span>
                          ) : null}
                        </div>
                      </Card>
                    ))}
                    {colItems.length === 0 && <div className="tb-col__empty">Nothing here</div>}
                    {status === 'done' && colItems.length > DONE_SHOWN && (
                      <div className="tb-col__more">
                        + {colItems.length - DONE_SHOWN} earlier done items in the DB
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            </>
          )}
        </main>
      </AppShell>

      <div
        className={`tb-backdrop${sheetId ? ' open' : ''}`}
        onClick={() => setSheetId(null)}
        aria-hidden="true"
      />
      <aside className={`tb-sheet${sheetId ? ' open' : ''}`} aria-hidden={!sheetId}>
        {sheetId && (
          <>
            <div className="tb-sheet__head">
              <span className="tb-card__id">{sheetId}</span>
              {detail && <span className="tb-card__kind">{detail.item.kind}</span>}
              <span style={{ marginLeft: 'auto' }}>
                <Button variant="outline" size="sm" onClick={() => setSheetId(null)}>
                  Close
                </Button>
              </span>
            </div>
            <div className="tb-sheet__body">
              {!detail || !form ? (
                <>
                  <Skeleton style={{ height: 24, marginBottom: 12 }} />
                  <Skeleton style={{ height: 90, marginBottom: 12 }} />
                  <Skeleton style={{ height: 90 }} />
                </>
              ) : (
                <>
                  <label className="tb-field">
                    <span>Title</span>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                  </label>
                  <div className="tb-field">
                    <span>Status</span>
                    <div className="tb-seg">
                      {ALL_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={form.status === s ? 'on' : ''}
                          onClick={() => setForm({ ...form, status: s })}
                        >
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="tb-row2">
                    <label className="tb-field">
                      <span>Priority</span>
                      <select
                        value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="tb-field">
                      <span>Points</span>
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        value={form.points}
                        onChange={(e) => setForm({ ...form, points: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="tb-row2">
                    <label className="tb-field">
                      <span>Assignee</span>
                      <input
                        type="text"
                        value={form.assignee}
                        onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                      />
                    </label>
                    <label className="tb-field">
                      <span>Due date</span>
                      <input
                        type="date"
                        value={form.due_at}
                        onChange={(e) => setForm({ ...form, due_at: e.target.value })}
                      />
                    </label>
                  </div>
                  <label className="tb-field">
                    <span>Body</span>
                    <textarea
                      value={form.body}
                      onChange={(e) => setForm({ ...form, body: e.target.value })}
                    />
                  </label>

                  <div className="tb-facts">
                    <div>
                      <b>Parent:</b> {detail.item.parent_id || '—'}
                    </div>
                    <div>
                      <b>Source:</b> {detail.item.source || '—'}
                      {detail.item.external_ref ? ` · Ref: ${detail.item.external_ref}` : ''}
                    </div>
                    <div>
                      <b>Created:</b> {fmtTs(detail.item.created_at)}
                    </div>
                    <div>
                      <b>Updated:</b> {fmtTs(detail.item.updated_at)}
                    </div>
                  </div>

                  <h4 className="tb-section-title">Comments</h4>
                  {detail.comments.length === 0 && (
                    <p className="tb-activity">No comments yet.</p>
                  )}
                  {detail.comments.map((c, i) => (
                    <div className="tb-comment" key={i}>
                      <div className="tb-comment__head">
                        {c.actor} · {fmtTs(c.ts)}
                      </div>
                      <div className="tb-comment__text">{c.text}</div>
                    </div>
                  ))}

                  <h4 className="tb-section-title">History</h4>
                  {detail.history.length === 0 && <p className="tb-activity">No changes yet.</p>}
                  {detail.history.map((h, i) => (
                    <p className="tb-activity" key={i}>
                      {fmtTs(h.ts)} · {h.actor} · {h.text}
                    </p>
                  ))}
                </>
              )}
            </div>
            <div className="tb-sheet__foot">
              <Button variant="primary" onClick={save} disabled={saving || !form}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {saveMsg && (
                <div className={`tb-savemsg ${saveMsg.kind}`}>{saveMsg.text}</div>
              )}
            </div>
          </>
        )}
      </aside>

      <Toaster toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}


