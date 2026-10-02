/**
 * Chat pane: thread list → conversation thread.
 *
 * Loads the gateway's model list on connect (honest: the picker only
 * offers models the gateway actually reports). With no base URL this
 * pane degrades to the scaffold's DemoBanner — no fake chat, ever.
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2, RefreshCw, MessageSquare } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { SelectField } from '@dsect/ui/components/forms';
import { QButton } from '../../lib/untitled';
import { DemoBanner } from '../../components/DemoBanner';
import { ago, fetchModels, SolApiError, type SolModel } from '../../api/sol';
import { ConversationView } from './ConversationView';
import {
  createThread,
  deleteThread,
  getActiveThreadId,
  getSelectedModel,
  listThreads,
  saveThread,
  setActiveThreadId,
  setSelectedModel,
  type ChatThread,
} from './store';

function friendlyError(error: unknown): string {
  if (error instanceof SolApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function ChatPane({ baseUrl }: { baseUrl: string }) {
  const connected = Boolean(baseUrl);
  const [models, setModels] = useState<SolModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState<string>(() => getSelectedModel());
  const [threads, setThreads] = useState<ChatThread[]>(() => listThreads());
  const [activeId, setActiveId] = useState<string | null>(() => getActiveThreadId());

  useEffect(() => {
    if (!baseUrl) {
      setModels(null);
      setModelsError(null);
      return;
    }
    let alive = true;
    setModelsError(null);
    setModels(null);
    fetchModels({ baseUrl })
      .then((list) => {
        if (!alive) return;
        setModels(list);
        const saved = getSelectedModel();
        const pick = saved && list.some((m) => m.id === saved) ? saved : (list[0]?.id ?? '');
        setModel((prev) => {
          if (pick && pick !== prev) setSelectedModel(pick);
          return pick || prev;
        });
      })
      .catch((e) => {
        if (alive) setModelsError(friendlyError(e));
      });
    return () => {
      alive = false;
    };
  }, [baseUrl]);

  function refreshThreads() {
    setThreads(listThreads());
    setActiveId(getActiveThreadId());
  }

  function openThread(id: string) {
    setActiveThreadId(id);
    setActiveId(id);
  }

  function newConversation() {
    const thread = createThread(model);
    saveThread(thread);
    setActiveThreadId(thread.id);
    setThreads(listThreads());
    setActiveId(thread.id);
  }

  function removeThread(id: string) {
    deleteThread(id);
    refreshThreads();
  }

  function pickModel(id: string) {
    setModel(id);
    setSelectedModel(id);
  }

  if (!connected) {
    return (
      <div className="flex flex-col gap-4">
        <DemoBanner configured={false} serviceLabel="Sol gateway" />
        <EmptyState
          title="Chat isn't connected"
          text="Add the Sol gateway base URL in More → Connection settings to talk to Sol. Until then this tab stays quiet — nothing here pretends to be Sol."
        />
      </div>
    );
  }

  if (modelsError && !models) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          title="Can't reach the Sol gateway"
          text={modelsError}
          actions={
            <QButton color="secondary" size="md" onPress={() => window.location.reload()}>
              <RefreshCw size={16} />
              Retry
            </QButton>
          }
        />
      </div>
    );
  }

  if (!models) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner label="Loading models from the Sol gateway" />
      </div>
    );
  }

  if (activeId) {
    return (
      <div className="flex flex-col">
        <ConversationView
          baseUrl={baseUrl}
          threadId={activeId}
          onBack={() => {
            setActiveThreadId(null);
            refreshThreads();
          }}
          onThreadChange={refreshThreads}
        />
      </div>
    );
  }

  const savedGone = model && !models.some((m) => m.id === model);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <SelectField
            label="Model"
            value={model}
            onChange={(e) => pickModel(e.target.value)}
          >
            {models.length === 0 && <option value="">No models reported</option>}
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </SelectField>
        </div>
        <QButton color="primary" size="lg" onPress={newConversation} aria-label="New conversation">
          <Plus size={18} />
          New
        </QButton>
      </div>
      {savedGone && (
        <div className="flex items-center gap-2">
          <Badge tone="warn" size="sm">
            Saved model “{model}” isn't on the gateway
          </Badge>
        </div>
      )}
      {modelsError && (
        <p className="text-sm text-text-secondary" role="status">
          Couldn't refresh the model list: {modelsError}
        </p>
      )}

      {threads.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          text="Start one and it'll persist on this device — even offline."
          inline
        />
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {threads.map((t) => (
            <li key={t.id}>
              <div className="flex items-center gap-2 rounded-lg border border-border-secondary bg-bg-primary p-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => openThread(t.id)}
                >
                  <MessageSquare size={18} className="shrink-0 text-text-secondary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-text-secondary">
                      {t.model || 'no model'} · {ago(Math.round((Date.now() - t.updatedAt) / 1000))}
                      {t.messages.length > 0 && ` · ${t.messages.length} messages`}
                    </span>
                  </span>
                </button>
                <QButton
                  color="secondary"
                  size="md"
                  onPress={() => removeThread(t.id)}
                  aria-label={`Delete conversation ${t.title}`}
                >
                  <Trash2 size={16} />
                </QButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
