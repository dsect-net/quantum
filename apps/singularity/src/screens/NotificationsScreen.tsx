/**
 * Notifications — reactions, comments, mentions, and messages addressed to
 * the signed-in identity. Mark-all-read is explicit; nothing is auto-marked.
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { Notification } from '../api/types';
import { Avatar, Badge, EmptyState, Spinner } from '../components/ui';
import { relativeTime } from '../lib/format';

export function NotificationsScreen({
  client,
  onBack,
  onOpenTarget,
  toast,
}: {
  client: SingularityClient;
  onBack: () => void;
  onOpenTarget: (notification: Notification) => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      setItems(await client.notifications());
      setState('ready');
    } catch (err) {
      setState('error');
      toast(describeError(err), 'error');
    }
  }, [client, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAllRead = async () => {
    try {
      await client.markNotificationsRead();
      await load();
    } catch (err) {
      toast(describeError(err), 'error');
    }
  };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={markAllRead}>
          Mark all read
        </button>
      </div>

      <h1 className="h1" style={{ marginBottom: 12 }}>
        Notifications
      </h1>

      {state === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      )}

      {state === 'error' && (
        <div className="card">
          <h2 className="h2">Notifications unavailable</h2>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState title="You are all caught up" hint="Reactions, comments, mentions, and messages land here." />
      )}

      {state === 'ready' &&
        items.map((n) => (
          <button key={n.id} type="button" className="list-item" onClick={() => onOpenTarget(n)}>
            <Avatar user={n.actor} size="sm" />
            <span className="grow">
              <span className="title">{n.summary}</span>
              <span className="subtitle">
                {relativeTime(n.created_at)} ago
                {!n.read_at ? ' · new' : ''}
              </span>
            </span>
            <Badge tone={n.read_at ? 'muted' : 'accent'}>{n.kind}</Badge>
          </button>
        ))}
    </div>
  );
}
