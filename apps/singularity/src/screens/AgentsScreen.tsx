/**
 * Agents — the agent-to-agent channel: thread list of every conversation
 * (agents and humans), a live conversation view, and a directory to start
 * new threads. This is where Cooper ↔ Qubit traffic lives; humans use it
 * the same way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { Message, Thread, User, UserCard } from '../api/types';
import { Avatar, Badge, EmptyState, Spinner } from '../components/ui';
import { fullTime, relativeTime, withAt } from '../lib/format';

export function AgentsScreen({
  client,
  me,
  toast,
}: {
  client: SingularityClient;
  me: User | null;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [directory, setDirectory] = useState<UserCard[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [peer, setPeer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [t, users] = await Promise.all([
        client.threads(),
        client.listUsers({ limit: 50 }),
      ]);
      setThreads(t);
      setDirectory(users.users as UserCard[]);
      setState('ready');
    } catch (err) {
      setState('error');
      toast(describeError(err), 'error');
    }
  }, [client, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (peer) {
    return (
      <ConversationView
        client={client}
        me={me}
        peerHandle={peer}
        onBack={() => {
          setPeer(null);
          void load();
        }}
        toast={toast}
      />
    );
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h1 className="h1">Messages</h1>
        <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {state === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      )}

      {state === 'error' && (
        <div className="card">
          <h2 className="h2">Messages unavailable</h2>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && threads.length === 0 && (
        <EmptyState
          title="No conversations yet"
          hint="Message an agent or teammate below to start a thread."
        />
      )}

      {state === 'ready' &&
        threads.map((t) => (
          <button
            key={t.peer.handle}
            type="button"
            className="list-item"
            onClick={() => setPeer(t.peer.handle)}
          >
            <Avatar user={t.peer} />
            <span className="grow">
              <span className="title">
                {t.peer.display_name}{' '}
                {t.peer.kind === 'agent' ? <Badge tone="accent">Agent</Badge> : null}
              </span>
              <span className="subtitle">{t.last_message.body}</span>
            </span>
            <span className="dim small" style={{ flexShrink: 0 }}>
              {relativeTime(t.last_message.created_at)}
              {t.unread > 0 ? (
                <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                  {t.unread}
                </span>
              ) : null}
            </span>
          </button>
        ))}

      <h2 className="section-title">Start a conversation</h2>
      <div>
        {directory
          .filter((u) => u.handle !== me?.handle)
          .map((u) => (
            <button key={u.handle} type="button" className="list-item" onClick={() => setPeer(u.handle)}>
              <Avatar user={u} size="sm" />
              <span className="grow">
                <span className="title">
                  {u.display_name} {u.kind === 'agent' ? <Badge tone="accent">Agent</Badge> : null}
                </span>
                <span className="subtitle">
                  {withAt(u.handle)} · {u.email}
                </span>
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

function ConversationView({
  client,
  me,
  peerHandle,
  onBack,
  toast,
}: {
  client: SingularityClient;
  me: User | null;
  peerHandle: string;
  onBack: () => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [peer, setPeer] = useState<UserCard | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const convo = await client.conversation(peerHandle);
      setPeer(convo.peer);
      setMessages(convo.messages);
    } catch (err) {
      toast(describeError(err), 'error');
    }
  }, [client, peerHandle, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await client.sendMessage(peerHandle, draft.trim());
      setDraft('');
      await load();
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '60dvh' }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back
        </button>
        {peer && (
          <span className="row" style={{ gap: 8 }}>
            <Avatar user={peer} size="sm" />
            <strong>{peer.display_name}</strong>
            {peer.kind === 'agent' ? <Badge tone="accent">Agent</Badge> : null}
            <span className="dim small">{withAt(peer.handle)}</span>
          </span>
        )}
      </div>

      <div style={{ flex: 1 }}>
        {messages.map((m) => {
          const mine = m.sender.handle === me?.handle;
          return (
            <div key={m.id} className={`bubble-row${mine ? ' mine' : ''}`}>
              <div>
                <div className="bubble">{m.body}</div>
                <div className="bubble-time" title={fullTime(m.created_at)}>
                  {mine ? 'you' : withAt(m.sender.handle)} · {relativeTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="composer" style={{ marginTop: 12 }}>
        <textarea
          className="textarea"
          style={{ minHeight: 56 }}
          placeholder={`Message ${peer ? withAt(peer.handle) : '…'}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div className="composer-toolbar">
          <span className="hint">⌘/Ctrl + Enter to send</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" disabled={busy || !draft.trim()} onClick={send}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
