/**
 * Agents sub-view: the live fleet, as in sol-app's Agents tab.
 *
 * Polls the Sol gateway's /api/sol/agents (15 s, pausing in the
 * background). Shows the shared-desk state, handoff banners, per-agent
 * state + activity, and a DM thread per agent. Honest empty states when
 * the gateway isn't configured or can't be reached.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Send, X } from 'lucide-react';
import { Badge, EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { Dialog } from '@dsect/ui/components/overlays';
import { QButton, QInput } from '../../lib/untitled';
import { DemoBanner } from '../../components/DemoBanner';
import {
  agentActivityLine,
  deskLine,
  dismissDeskHandoff,
  fetchDm,
  fetchFleetSnapshot,
  fleetEnabled,
  sendDm,
  SolApiError,
  type DmMessage,
  type FleetAgent,
  type FleetSnapshot,
} from '../../api/sol';

const STATE_TONE: Record<string, 'ok' | 'warn' | 'slate' | 'neutral'> = {
  working: 'ok',
  blocked: 'warn',
  idle: 'slate',
};

const STATE_LABEL: Record<string, string> = {
  working: 'Working',
  blocked: 'Needs you',
  idle: 'Idle',
};

function friendlyError(error: unknown): string {
  if (error instanceof SolApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function useFleet(baseUrl: string) {
  const enabled = fleetEnabled(baseUrl);
  const [data, setData] = useState<FleetSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await fetchFleetSnapshot(baseUrl));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [enabled, baseUrl]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden && alive) await refresh();
      if (alive) timer = setTimeout(tick, 15_000);
    };
    void tick();
    const wake = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [enabled, refresh]);

  return { enabled, data, error, refresh };
}

export function AgentsView({ baseUrl }: { baseUrl: string }) {
  const { enabled, data, error, refresh } = useFleet(baseUrl);
  const [dmAgent, setDmAgent] = useState<FleetAgent | null>(null);

  async function dismissHandoff() {
    try {
      await dismissDeskHandoff(baseUrl);
    } catch {
      /* banner stays; retry happens on next poll */
    }
    void refresh();
  }

  if (!enabled) {
    return (
      <div className="flex flex-col gap-4">
        <DemoBanner configured={false} serviceLabel="Sol gateway" />
        <EmptyState
          title="Fleet not connected"
          text="Add the Sol gateway base URL in More → Connection settings to see the live agents. The roster only ever shows real gateway data."
        />
      </div>
    );
  }

  if (!data && error) {
    return (
      <EmptyState
        title="Can't reach the fleet"
        text={
          error instanceof SolApiError && error.status === 401
            ? 'The gateway couldn\u2019t tell who this device is. Connect to the tailnet and try again.'
            : `${friendlyError(error)} Retrying in the background.`
        }
        actions={
          <QButton color="secondary" size="md" onPress={() => void refresh()}>
            Retry now
          </QButton>
        }
      />
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner label="Connecting to the fleet" />
      </div>
    );
  }

  const handoff = data.desk?.handoff;
  const handoffAgent =
    handoff && handoff.status !== 'scott_has_desk'
      ? data.agents.find((a) => a.workspace === handoff.bot) ?? null
      : null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-sm text-text-secondary" role="status">
          Couldn't refresh — showing the last known state.
        </p>
      ) : null}

      {handoffAgent && (
        <div className="flex items-center gap-3 rounded-lg border border-text-warning-primary bg-bg-primary p-3">
          <span className="flex min-w-0 flex-1 flex-col">
            <b>{handoffAgent.name} needs you at the desk</b>
            <small className="text-text-secondary">{handoff?.reason}</small>
          </span>
          <QButton color="primary" size="md" onPress={() => setDmAgent(handoffAgent)}>
            Open
          </QButton>
          <QButton color="secondary" size="md" onPress={dismissHandoff} aria-label="Dismiss handoff">
            <X size={16} />
          </QButton>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-lg border border-border-secondary bg-bg-primary p-3">
        <Monitor size={20} className="shrink-0 text-text-secondary" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <b>Shared desk</b>
          <small className="text-text-secondary">{deskLine(data.desk, data.agents)}</small>
        </span>
      </div>

      {data.agents.length === 0 ? (
        <EmptyState title="No agents reported" text="The gateway answered but listed no agents." inline />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg border border-border-secondary bg-bg-primary p-3 text-left"
                onClick={() => setDmAgent(agent)}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg-brand-solid text-lg font-bold text-text-primary_on-brand"
                  aria-hidden
                >
                  {agent.name.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <b className="truncate">{agent.name}</b>
                    <Badge tone={STATE_TONE[agent.state ?? ''] ?? 'neutral'} size="sm" dot>
                      {STATE_LABEL[agent.state ?? ''] ?? agent.state ?? 'unknown'}
                    </Badge>
                  </span>
                  <small className="truncate text-text-secondary">{agentActivityLine(agent)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={dmAgent !== null}
        variant="sheet"
        title={dmAgent ? `DM · ${dmAgent.name}` : 'DM'}
        onClose={() => setDmAgent(null)}
      >
        {dmAgent && <DmThread baseUrl={baseUrl} agent={dmAgent} onClose={() => setDmAgent(null)} />}
      </Dialog>
    </div>
  );
}

function dmText(m: DmMessage): string {
  const t = m.text ?? m.content ?? m.body;
  return typeof t === 'string' ? t : JSON.stringify(m);
}

function dmAuthor(m: DmMessage): string {
  const a = m.author ?? m.from ?? m.sender;
  return typeof a === 'string' ? a : 'agent';
}

function dmTs(m: DmMessage): number | null {
  const t = m.ts ?? m.timestamp ?? m.id;
  return typeof t === 'number' ? t : null;
}

function DmThread({ baseUrl, agent }: { baseUrl: string; agent: FleetAgent; onClose: () => void }) {
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sinceRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const batch = await fetchDm(baseUrl, agent.id, sinceRef.current);
      if (batch.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => JSON.stringify(m)));
          const fresh = batch.filter((m) => !seen.has(JSON.stringify(m)));
          return [...prev, ...fresh];
        });
        const max = Math.max(
          ...batch.map(dmTs).filter((t): t is number => t !== null),
          sinceRef.current,
        );
        sinceRef.current = max;
      }
      setError(null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }, [baseUrl, agent.id]);

  useEffect(() => {
    setMessages([]);
    sinceRef.current = 0;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (alive) await load();
      if (alive) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    const clean = draft.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      await sendDm(baseUrl, agent.id, clean);
      setDraft('');
      await load();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSending(false);
    }
  }

  const meNames = ['you', 'scott', 'human'];

  return (
    <div className="flex flex-col">
      <div ref={listRef} className="flex min-h-[30dvh] flex-col gap-2 overflow-y-auto py-2">
        {messages.length === 0 && !error && (
          <p className="text-sm text-text-secondary">No messages yet — say hello.</p>
        )}
        {error && (
          <p className="text-sm text-text-error-primary" role="alert">
            {error}
          </p>
        )}
        {messages.map((m, i) => {
          const mine = meNames.includes(dmAuthor(m).toLowerCase());
          return (
            <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[15px] ${
                  mine ? 'rounded-br-md bg-bg-brand-solid text-text-primary_on-brand' : 'rounded-bl-md bg-bg-primary'
                }`}
              >
                <p className="pb-0.5 text-xs opacity-70">{dmAuthor(m)}</p>
                {dmText(m)}
              </div>
            </div>
          );
        })}
      </div>
      <form
        className="flex items-end gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <QInput
          className="flex-1"
          placeholder={`Message ${agent.name}…`}
          value={draft}
          isDisabled={sending}
          onChange={(v) => setDraft(v)}
          aria-label={`Message ${agent.name}`}
        />
        <QButton color="primary" size="lg" onPress={() => void send()} isDisabled={!draft.trim() || sending} aria-label="Send DM">
          <Send size={18} />
        </QButton>
      </form>
    </div>
  );
}
