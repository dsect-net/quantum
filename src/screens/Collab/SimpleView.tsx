/**
 * Collab simple view — clean task lists, the default.
 * Goals as cards with progress → tap to expand sub-goals → checkboxes for tasks.
 */
import { useState } from 'react';
import { Card } from '@dsect/ui/components/surfaces';
import { Badge, EmptyState, ProgressBar, Spinner } from '@dsect/ui/components/feedback';
import { Checkbox, TextField } from '@dsect/ui/components/forms';
import { Button } from '@dsect/ui/components/buttons';
import { ChevronDown, Plus } from 'lucide-react';
import type { CollabClient, CollabGoal, CollabSubGoal, CollabTask } from '../../api/collab';

interface SimpleViewProps {
  client: CollabClient;
  goals: CollabGoal[];
  loading: boolean;
  onChanged: () => void;
}

function isOverdue(task: CollabTask): boolean {
  if (!task.dueDate || task.status === 'done') return false;
  return task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function TaskRow({ client, task, onChanged }: { client: CollabClient; task: CollabTask; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.moveTask(task.id, task.status === 'done' ? 'todo' : 'done');
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="py-2">
      <Checkbox
        label={
          <span className="flex-1 min-w-0">
            <span className={task.status === 'done' ? 'line-through opacity-60' : ''}>{task.title}</span>
            <span className="flex flex-wrap gap-1 mt-1">
              {task.assignee && <Badge tone="info">{task.assignee}</Badge>}
              {task.dueDate && (
                <Badge tone={isOverdue(task) ? 'err' : 'slate'}>{task.dueDate.slice(0, 10)}</Badge>
              )}
              {task.tags.map((t) => (
                <Badge key={t} tone="neutral">{t}</Badge>
              ))}
            </span>
          </span>
        }
        checked={task.status === 'done'}
        onChange={toggle}
        disabled={busy}
      />
    </div>
  );
}

function SubGoalBlock({ client, sub, onChanged }: { client: CollabClient; sub: CollabSubGoal; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const addTask = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await client.createTask(sub.id, { title: t });
      setTitle('');
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const tasks = sub.tasks ?? [];
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium text-sm">{sub.title}</h4>
        <span className="text-xs opacity-60">{Math.round(sub.progress * 100)}%</span>
      </div>
      <ProgressBar value={Math.round(sub.progress * 100)} className="my-1" />
      <div className="divide-y divide-[var(--border)]">
        {tasks.map((t) => (
          <TaskRow key={t.id} client={client} task={t} onChanged={onChanged} />
        ))}
      </div>
      {tasks.length === 0 && <p className="text-xs opacity-60 py-1">No tasks yet.</p>}
      {adding ? (
        <div className="flex gap-2 mt-2">
          <TextField
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            label="New task"
            placeholder="New task…"
            onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
          />
          <Button size="sm" onClick={addTask} disabled={busy}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setAdding(true)} className="mt-1">
          <Plus size={14} /> Task
        </Button>
      )}
    </div>
  );
}

export function SimpleView({ client, goals, loading, onChanged }: SimpleViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CollabGoal | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const toggleGoal = async (goal: CollabGoal) => {
    if (openId === goal.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(goal.id);
    setDetailBusy(true);
    try {
      const full = await client.goalDetail(goal.id);
      setDetail(full ?? { ...goal, subgoals: [] });
    } finally {
      setDetailBusy(false);
    }
  };

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (goals.length === 0) {
    return (
      <EmptyState
        title="No goals yet"
        text="Create your first goal to start tracking."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {goals.map((goal) => {
        const open = openId === goal.id;
        return (
          <Card key={goal.id} className="p-4">
            <button
              type="button"
              onClick={() => toggleGoal(goal)}
              className="w-full text-left"
              aria-expanded={open}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{goal.title}</h3>
                <ChevronDown size={18} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <ProgressBar value={Math.round(goal.progress * 100)} className="flex-1" />
                <span className="text-xs opacity-60 whitespace-nowrap">{Math.round(goal.progress * 100)}%</span>
                <Badge tone={goal.status === 'done' ? 'ok' : goal.status === 'paused' ? 'warn' : 'info'}>
                  {goal.status}
                </Badge>
              </div>
              {goal.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {goal.tags.map((t) => (
                    <Badge key={t} tone="neutral">{t}</Badge>
                  ))}
                </div>
              )}
            </button>
            {open && (
              <div className="mt-2">
                {detailBusy && <div className="flex justify-center py-4"><Spinner size="sm" /></div>}
                {!detailBusy && detail?.description && (
                  <p className="text-sm opacity-70 mb-1">{detail.description}</p>
                )}
                {!detailBusy && (detail?.subgoals ?? []).map((sub) => (
                  <SubGoalBlock key={sub.id} client={client} sub={sub} onChanged={onChanged} />
                ))}
                {!detailBusy && (detail?.subgoals ?? []).length === 0 && (
                  <p className="text-xs opacity-60 py-2">No sub-goals yet.</p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
