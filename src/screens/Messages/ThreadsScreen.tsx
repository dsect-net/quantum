/**
 * Recent threads list — GET /recent, grouped into conversation rows.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { QButton } from '../../lib/untitled';
import {
  formatRelayTime,
  getRecent,
  groupIntoThreads,
  type RelayThread,
} from '../../api/relay';

export interface ThreadsScreenProps {
  baseUrl: string;
  onOpenThread: (thread: RelayThread) => void;
}

export function ThreadsScreen({ baseUrl, onOpenThread }: ThreadsScreenProps) {
  const [threads, setThreads] = useState<RelayThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!baseUrl) return;
    setError(null);
    try {
      setThreads(groupIntoThreads(await getRecent(baseUrl)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setThreads(null);
    }
  }, [baseUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!baseUrl) {
    return (
      <EmptyState
        mark="∅"
        title="Relay not connected"
        text="Add the relay base URL in More → Connection settings to see the team's recent threads."
        actions={<Badge tone="warn" size="sm">Not connected</Badge>}
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        mark="!"
        title="Couldn't reach the relay"
        text={error}
        actions={
          <QButton size="lg" onClick={() => void load()}>
            Retry
          </QButton>
        }
      />
    );
  }

  if (!threads) {
    return (
      <div className="flex justify-center py-10">
        <Spinner label="Loading recent threads" />
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        mark="◌"
        title="No threads yet"
        text="The relay's recent window is empty — nothing has been posted recently."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Recent threads">
      {threads.map((t) => (
        <li key={t.conversationId}>
          <button
            type="button"
            onClick={() => onOpenThread(t)}
            className="flex min-h-[64px] w-full items-center gap-3 rounded-lg border p-3 text-left active:opacity-70"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{t.name}</div>
              <div className="truncate text-sm text-text-secondary">
                <span className="font-medium">{t.lastMessage.author_display || t.lastMessage.author}:</span>{' '}
                {t.lastMessage.content}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs text-text-secondary">
                {formatRelayTime(t.lastMessage.timestamp)}
              </span>
              <Badge tone="info" size="sm">
                {t.messageCount}
              </Badge>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
