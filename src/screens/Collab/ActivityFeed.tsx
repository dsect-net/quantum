/**
 * Collab activity feed — who did what, newest first.
 */
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import type { CollabActivityEvent } from '../../api/collab';

const KIND_TONE: Record<string, 'ok' | 'warn' | 'err' | 'info' | 'slate' | 'neutral'> = {
  'goal.create': 'info',
  'goal.status': 'warn',
  'subgoal.create': 'info',
  'task.create': 'info',
  'task.move': 'ok',
  'task.delete': 'err',
  'goal.delete': 'err',
};

function kindLabel(kind: string): string {
  const [entity, action] = kind.split('.');
  if (!entity || !action) return kind;
  return `${entity} ${action}`;
}

export function ActivityFeed({ events, loading }: { events: CollabActivityEvent[]; loading: boolean }) {
  if (loading) return <div className="flex justify-center py-6"><Spinner size="sm" /></div>;
  if (events.length === 0) return <EmptyState inline title="No activity yet" text="Actions on goals and tasks will show up here." />;
  return (
    <ol className="flex flex-col gap-2">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm">
          <Badge tone={KIND_TONE[e.kind] ?? 'neutral'}>{kindLabel(e.kind)}</Badge>
          <span className="flex-1 min-w-0">
            {e.detail && <span className="font-medium">{e.detail}</span>}
            {e.actor && <span className="opacity-60"> · {e.actor}</span>}
            <span className="opacity-50 block text-xs">
              {e.at ? new Date(e.at).toLocaleString() : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
