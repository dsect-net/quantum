/**
 * Conversation thread: message bubbles + composer.
 *
 * Assistant replies stream in live from the Sol gateway (SSE). Any
 * failure renders an honest error bubble with a retry — never a fake
 * reply. History persists on-device via the local store.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Square, RotateCcw } from 'lucide-react';
import { Badge } from '@dsect/ui/components/feedback';
import { EmptyState } from '@dsect/ui/components/feedback';
import { QButton } from '../../lib/untitled';
import {
  SolApiError,
  sendChatCompletion,
  type ChatMessage,
} from '../../api/sol';
import {
  getThread,
  saveThread,
  titleFromMessage,
  type ChatThread,
  type StoredMessage,
} from './store';

export interface ConversationViewProps {
  baseUrl: string;
  threadId: string;
  onBack: () => void;
  onThreadChange: () => void;
}

function friendlyError(error: unknown): string {
  if (error instanceof SolApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function ConversationView({ baseUrl, threadId, onBack, onThreadChange }: ConversationViewProps) {
  const [thread, setThread] = useState<ChatThread | null>(() => getThread(threadId));
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef(threadId);

  // Reload when a different thread is opened.
  useEffect(() => {
    threadIdRef.current = threadId;
    setThread(getThread(threadId));
    setDraft('');
  }, [threadId]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, thread?.messages[thread.messages.length - 1]?.content.length]);

  function persist(next: ChatThread) {
    setThread(next);
    saveThread(next);
    onThreadChange();
  }

  async function runCompletion(history: StoredMessage[], asstIndex: number) {
    if (!thread) return;
    const outgoing: ChatMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const full = await sendChatCompletion({
        baseUrl,
        model: thread.model,
        messages: outgoing,
        stream: true,
        onToken: (delta) => {
          const current = getThread(threadIdRef.current);
          if (!current) return;
          const msgs = current.messages.slice();
          const target = msgs[asstIndex];
          if (target && target.role === 'assistant') {
            msgs[asstIndex] = { ...target, content: target.content + delta };
            persist({ ...current, messages: msgs, updatedAt: Date.now() });
          }
        },
        signal: controller.signal,
      });
      const current = getThread(threadIdRef.current);
      if (current) {
        const msgs = current.messages.slice();
        const target = msgs[asstIndex];
        if (target && target.role === 'assistant') {
          msgs[asstIndex] = { ...target, content: full, error: undefined };
          persist({ ...current, messages: msgs, updatedAt: Date.now() });
        }
      }
    } catch (error) {
      // An aborted stream the user stopped is not an error to display.
      const aborted = error instanceof SolApiError && error.code === 'aborted';
      const current = getThread(threadIdRef.current);
      if (current) {
        const msgs = current.messages.slice();
        const target = msgs[asstIndex];
        if (target && target.role === 'assistant') {
          if (aborted && target.content) {
            // Keep the partial reply; mark it as cut short, honestly.
            msgs[asstIndex] = { ...target, error: 'Stopped — showing the partial reply.' };
          } else if (!aborted) {
            msgs[asstIndex] = { ...target, error: friendlyError(error) };
          }
          persist({ ...current, messages: msgs, updatedAt: Date.now() });
        }
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function send(text: string) {
    const clean = text.trim();
    if (!clean || streaming || !thread) return;
    const now = Date.now();
    const userMsg: StoredMessage = { role: 'user', content: clean, ts: now };
    const asstMsg: StoredMessage = { role: 'assistant', content: '', ts: now };
    const messages = [...thread.messages, userMsg, asstMsg];
    const titled = thread.messages.length === 0 ? titleFromMessage(clean) : thread.title;
    const next: ChatThread = { ...thread, title: titled, messages, updatedAt: now };
    setDraft('');
    persist(next);
    void runCompletion(next.messages, messages.length - 1);
  }

  function retry(index: number) {
    if (!thread || streaming) return;
    const msgs = thread.messages.slice(0, index);
    const asstMsg: StoredMessage = { role: 'assistant', content: '', ts: Date.now() };
    const next: ChatThread = { ...thread, messages: [...msgs, asstMsg], updatedAt: Date.now() };
    persist(next);
    void runCompletion(next.messages, next.messages.length - 1);
  }

  function stop() {
    abortRef.current?.abort();
  }

  if (!thread) {
    return <EmptyState title="Conversation not found" text="It may have been deleted." />;
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 pb-2">
        <QButton color="secondary" size="md" onPress={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </QButton>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{thread.title}</h3>
          <p className="truncate text-xs text-text-secondary">{thread.model}</p>
        </div>
      </div>

      <div ref={listRef} className="flex max-h-[55dvh] flex-col gap-3 overflow-y-auto py-2">
        {thread.messages.length === 0 && (
          <EmptyState
            title="Say hello to Sol"
            text="Messages stream live from the Sol gateway. Nothing here is canned."
            inline
          />
        )}
        {thread.messages.map((m, i) => (
          <MessageBubble
            key={`${m.ts}-${i}`}
            message={m}
            streaming={streaming && m.role === 'assistant' && i === thread.messages.length - 1}
            onRetry={() => retry(i)}
          />
        ))}
      </div>

      <form
        className="flex items-end gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <textarea
          className="min-h-[44px] max-h-32 flex-1 resize-none rounded-lg border border-border-secondary bg-bg-primary p-3 text-base outline-none focus:border-text-brand-secondary"
          rows={2}
          placeholder={streaming ? 'Sol is replying…' : 'Message Sol…'}
          value={draft}
          disabled={streaming}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          aria-label="Message Sol"
        />
        {streaming ? (
          <QButton color="secondary" size="lg" onPress={stop} aria-label="Stop reply">
            <Square size={18} />
          </QButton>
        ) : (
          <QButton color="primary" size="lg" onPress={() => send(draft)} isDisabled={!draft.trim()} aria-label="Send">
            <Send size={18} />
          </QButton>
        )}
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  onRetry,
}: {
  message: StoredMessage;
  streaming: boolean;
  onRetry: () => void;
}) {
  const mine = message.role === 'user';
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-bg-brand-solid px-3 py-2 text-[15px] text-text-primary_on-brand">
          {message.content}
        </div>
      </div>
    );
  }
  if (message.error && !message.content) {
    return (
      <div className="flex justify-start">
        <div className="flex max-w-[85%] flex-col gap-2 rounded-2xl rounded-bl-md border border-dashed border-border-error bg-bg-primary px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge tone="err" size="sm">
              Reply failed
            </Badge>
          </div>
          <p className="text-sm text-text-secondary">{message.error}</p>
          <QButton color="secondary" size="md" onPress={onRetry}>
            <RotateCcw size={16} />
            Retry
          </QButton>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-bg-primary px-3 py-2">
        <p className="whitespace-pre-wrap text-[15px]">{message.content}</p>
        {message.error && (
          <p className="pt-1 text-xs text-text-secondary">{message.error}</p>
        )}
        {streaming && !message.content && (
          <p className="text-sm text-text-secondary" role="status">
            Sol is thinking…
          </p>
        )}
      </div>
    </div>
  );
}
