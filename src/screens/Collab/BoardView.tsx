/**
 * Collab board view — the advanced surface.
 * Kanban columns (To do / Doing / Done) with HTML5 drag-between-columns
 * plus click-to-move arrows (the phone-friendly fallback), tag filter,
 * goal scoping, and due-date coloring.
 */
import { useState } from 'react';
import { Card } from '@dsect/ui/components/surfaces';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { IconButton } from '@dsect/ui/components/buttons';
import { FilterBar, FilterSelect, SearchInput } from '@dsect/ui/components/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { CollabClient, CollabGoal, CollabTag, CollabTask, KanbanBoard, TaskStatus } from '../../api/collab';

interface BoardViewProps {
  client: CollabClient;
  goals: CollabGoal[];
  tags: CollabTag[];
  board: KanbanBoard | null;
  loading: boolean;
  goalId: string | null;
  onGoalId: (id: string | null) => void;
  onChanged: () => void;
}

const COLUMNS: { id: TaskStatus; title: string }[] = [
  { id: 'todo', title: 'To do' },
  { id: 'doing', title: 'Doing' },
  { id: 'done', title: 'Done' },
];

function isOverdue(task: CollabTask): boolean {
  if (!task.dueDate || task.status === 'done') return false;
  return task.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function TaskCard({ client, task, onChanged }: { client: CollabClient; task: CollabTask; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const move = async (status: TaskStatus) => {
    if (busy || status === task.status) return;
    setBusy(true);
    try {
      await client.moveTask(task.id, status);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const idx = COLUMNS.findIndex((c) => c.id === task.status);

  return (
    <Card
      className="p-3 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/collab-task-id', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
    >
      <p className="text-sm font-medium">{task.title}</p>
      {(task.goalTitle || task.subGoalTitle) && (
        <p className="text-xs opacity-60 mt-0.5">
          {[task.goalTitle, task.subGoalTitle].filter(Boolean).join(' › ')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1 mt-2">
        {task.assignee && <Badge tone="info">{task.assignee}</Badge>}
        {task.dueDate && <Badge tone={isOverdue(task) ? 'err' : 'slate'}>{task.dueDate.slice(0, 10)}</Badge>}
        {task.tags.map((t) => (
          <Badge key={t} tone="neutral">{t}</Badge>
        ))}
      </div>
      <div className="flex justify-between mt-2">
        <IconButton
          label={`Move "${task.title}" back`}
          onClick={() => idx > 0 && move(COLUMNS[idx - 1].id)}
          disabled={busy || idx <= 0}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          label={`Move "${task.title}" forward`}
          onClick={() => idx < COLUMNS.length - 1 && move(COLUMNS[idx + 1].id)}
          disabled={busy || idx >= COLUMNS.length - 1}
        >
          <ArrowRight size={16} />
        </IconButton>
      </div>
    </Card>
  );
}

export function BoardView({ client, goals, tags, board, loading, goalId, onGoalId, onChanged }: BoardViewProps) {
  const [tagFilter, setTagFilter] = useState('');
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);

  const drop = async (e: React.DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData('text/collab-task-id');
    if (!id) return;
    await client.moveTask(id, status);
    onChanged();
  };

  const matches = (t: CollabTask) => {
    if (tagFilter && !t.tags.includes(tagFilter)) return false;
    if (query) {
      const hay = [t.title, t.assignee ?? '', t.goalTitle ?? '', t.subGoalTitle ?? '', ...t.tags]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    return true;
  };

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!board) return <EmptyState title="Board unavailable" text="Could not load the kanban board." />;

  const total = board.counts.todo + board.counts.doing + board.counts.done;

  return (
    <div>
      <FilterBar>
        <FilterSelect
          aria-label="Scope to goal"
          value={goalId ?? ''}
          onChange={(e) => onGoalId(e.target.value || null)}
        >
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </FilterSelect>
        <FilterSelect aria-label="Filter by tag" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.label}>{t.label}</option>
          ))}
        </FilterSelect>
        <SearchInput
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </FilterBar>

      {total === 0 ? (
        <EmptyState title="No tasks on the board" text="Tasks appear here once a goal has sub-goals with tasks." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          {COLUMNS.map((col) => {
            const cards = board.columns[col.id].filter(matches);
            return (
              <section
                key={col.id}
                aria-label={`${col.title} column`}
                className={`rounded-lg p-2 min-h-32 ${dragOver === col.id ? 'outline-2 outline-dashed outline-[var(--accent)]' : 'bg-[var(--surface-2)]'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
                onDragLeave={() => setDragOver((d) => (d === col.id ? null : d))}
                onDrop={(e) => drop(e, col.id)}
              >
                <header className="flex items-center justify-between px-1 py-1">
                  <h3 className="font-semibold text-sm">{col.title}</h3>
                  <Badge tone="slate">{board.columns[col.id].length}</Badge>
                </header>
                <div className="flex flex-col gap-2">
                  {cards.map((t) => (
                    <TaskCard key={t.id} client={client} task={t} onChanged={onChanged} />
                  ))}
                  {cards.length === 0 && (
                    <p className="text-xs opacity-50 text-center py-4">Drop tasks here</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
