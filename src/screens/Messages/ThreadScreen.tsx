/**
 * Thread view — messages in one conversation with a send box.
 *
 * Loads the tail via GET /recent (filtered to this conversation), then polls
 * GET /messages?since=<last id> for deltas. Send box: POST /send for a plain
 * message, POST /ask for a synchronous model answer (both land in the log
 * and arrive via the same poll).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { TextArea } from '@dsect/ui/components/forms';
import { QButton, QInput } from '../../lib/untitled';
import {
  askRelay,
  formatRelayTime,
  getMessagesSince,
  getRecent,
  getRelayIdentity,
  sendMessage,
  type RelayMessage,
  type RelayThread,
} from '../../api/relay';

const POLL_MS = 4000;

export interface ThreadScreenProps {
  baseUrl: string;
  thread: RelayThread;
  onBack: () => void;
}

export function ThreadScreen({ baseUrl, thread, onBack }: ThreadScreenProps) {
  const [messages, setMessages] = useState<RelayMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState<'send' | 'ask' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const merge = useCallback((incoming: RelayMessage[]) => {
    const mine = incoming.filter((m) => m.conversation_id === thread.conversationId);
    if (mine.length === 0) return;
    setMessages((prev) => {
      const seen = new Set((prev ?? []).map((m) => m.id));
      const next = [...(prev ?? []), ...mine.filter((m) => !seen.has(m.id))];
      next.sort((a, b) => a.id - b.id);
      return next.slice(-200);
    });
  }, [thread.conversationId]);

  const loadInitial = useCallback(async () => {
    setError(null);
    try {
      merge(await getRecent(baseUrl, 200));
      setMessages((prev) => prev ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [baseUrl, merge]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Tailnet identity → default author handle. If it fails, the handle stays
  // editable so the user can type one by hand.
  useEffect(() => {
    let cancelled = false;
    getRelayIdentity(baseUrl)
      .then((id) => {
        if (!cancelled) setHandle((h) => h || id.handle);
      })
      .catch(() => {
        // Manual handle entry remains available.
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    const timer = setInterval(async () => {
      setMessages((prev) => {
        const maxId = prev && prev.length > 0 ? prev[prev.length - 1].id : 0;
        void getMessagesSince(baseUrl, maxId)
          .then(merge)
          .catch(() => {
            // Poll failures stay silent; the next tick retries.
          });
        return prev;
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [baseUrl, merge]);

  useEffect(() => {
    // jsdom (unit tests) has no scrollIntoView — guard it.
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const submit = async (kind: 'send' | 'ask') => {
    const text = draft.trim();
    if (!text || busy) return;
    const author = handle.trim();
    if (!author) {
      setNotice('Enter your handle before posting — the relay needs an author.');
      return;
    }
    setBusy(kind);
    setNotice(null);
    try {
      if (kind === 'send') {
        await sendMessage(baseUrl, author, text);
      } else {
        await askRelay(baseUrl, author, author, text);
      }
      setDraft('');
      // Pick up the new row(s) immediately instead of waiting for the poll.
      setMessages((prev) => {
        const maxId = prev && prev.length > 0 ? prev[prev.length - 1].id : 0;
        void getMessagesSince(baseUrl, maxId).then(merge).catch(() => {});
        return prev;
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-[60dvh] flex-col gap-3">
      <div className="flex items-center gap-2">
        <QButton size="lg" onClick={onBack} aria-label="Back to threads">
          ←
        </QButton>
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{thread.name}</h2>
      </div>

      {error ? (
        <EmptyState
          mark="!"
          title="Couldn't load this thread"
          text={error}
          actions={
            <QButton size="lg" onClick={() => void loadInitial()}>
              Retry
            </QButton>
          }
        />
      ) : messages === null ? (
        <div className="flex justify-center py-10">
          <Spinner label="Loading thread" />
        </div>
      ) : messages.length === 0 ? (
        <EmptyState
          mark="◌"
          title="No messages in this window"
          text="Nothing in the relay's recent window belongs to this conversation yet."
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Messages">
          {messages.map((m) => {
            const mine = m.author === handle || m.author_display === handle;
            return (
              <li
                key={m.id}
                className={`flex flex-col gap-0.5 rounded-lg border p-2.5 ${
                  mine ? 'ml-8' : 'mr-8'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {m.author_display || m.author}
                  </span>
                  <span className="shrink-0 text-xs text-text-secondary">
                    {formatRelayTime(m.timestamp)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                {m.mentions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {m.mentions.map((who) => (
                      <Badge key={who} tone="info" size="sm">
                        @{who}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div ref={bottomRef} />

      <div className="sticky bottom-0 flex flex-col gap-2 border-t pt-3">
        {notice && (
          <div role="alert" className="rounded-lg border p-2 text-sm">
            {notice}
          </div>
        )}
        <div className="flex gap-2">
          <div className="w-28 shrink-0">
            <QInput
              label="Handle"
              placeholder="handle"
              value={handle}
              onChange={setHandle}
            />
          </div>
          <div className="min-w-0 flex-1">
            <TextArea
              label="Message"
              placeholder="Message the team…"
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <QButton
            size="lg"
            className="flex-1"
            isDisabled={busy !== null || !draft.trim()}
            onClick={() => void submit('send')}
          >
            {busy === 'send' ? 'Sending…' : 'Send'}
          </QButton>
          <QButton
            size="lg"
            className="flex-1"
            isDisabled={busy !== null || !draft.trim()}
            onClick={() => void submit('ask')}
          >
            {busy === 'ask' ? 'Asking…' : 'Ask relay'}
          </QButton>
        </div>
      </div>
    </div>
  );
}
