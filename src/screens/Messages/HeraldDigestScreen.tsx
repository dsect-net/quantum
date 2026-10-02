/**
 * Herald digest screen.
 *
 * The view renders three honest states:
 *  - `data`        — a real digest payload (supported and unit-tested, for
 *                    the day hub-api exposes one).
 *  - `not-exposed` — today's reality: herald writes per-agent
 *                    inbox_status.json on Tritium, but no hub-api HTTP
 *                    endpoint serves it, so there is no live digest to show.
 *  - `error`       — a failed probe, with the message surfaced.
 *
 * Production always receives `not-exposed` (see src/api/herald.ts). Nothing
 * here is faked: the screen names the missing endpoint instead of
 * inventing data for it.
 */
import { useEffect, useState } from 'react';
import { Badge, EmptyState } from '@dsect/ui/components/feedback';
import { QButton } from '../../lib/untitled';
import { getSettings } from '../../lib/settings';
import { probeHeraldDigest, type HeraldDigestState } from '../../api/herald';

const URGENCY_TONE = {
  low: 'slate',
  normal: 'neutral',
  high: 'warn',
  urgent: 'err',
} as const;

export function HeraldDigestView({ state }: { state: HeraldDigestState }) {
  if (state.status === 'data') {
    const { digest } = state;
    if (digest.agents.length === 0) {
      return (
        <EmptyState
          mark="◌"
          title="Herald digest"
          text="The digest is empty — no agent inboxes reported."
        />
      );
    }
    return (
      <div className="flex flex-col gap-3" aria-label="Herald digest">
        {digest.agents.map((a) => (
          <section key={a.agent} className="rounded-lg border p-3" aria-label={`${a.agent} inbox`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{a.agent}</h3>
              <div className="flex gap-1">
                <Badge tone="info" size="sm">{a.unread} unread</Badge>
                <Badge tone="warn" size="sm">{a.needsAction} action</Badge>
                <Badge tone="err" size="sm">{a.urgent} urgent</Badge>
              </div>
            </div>
            <ul className="mt-2 flex flex-col gap-2">
              {a.items.map((item, i) => (
                <li key={i} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{item.subject}</span>
                    <Badge tone={URGENCY_TONE[item.urgency]} size="sm">
                      {item.urgency}
                    </Badge>
                  </div>
                  <p className="text-sm text-text-secondary">{item.summary}</p>
                  <p className="text-xs text-text-secondary">from {item.from}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        mark="!"
        title="Digest check failed"
        text={state.message}
        actions={<Badge tone="err" size="sm">Error</Badge>}
      />
    );
  }

  return (
    <EmptyState
      mark="◌"
      title="Herald digest"
      text={
        <>
          Not yet exposed via API. Herald triages every agent mailbox on
          Tritium and writes a per-agent <span className="font-mono">inbox_status.json</span>{' '}
          (unread / action-needed / urgent + summaries), but hub-api serves no
          HTTP endpoint for it yet — verified Oct 2, 2026 against the hub-api
          routes and the Phase-1 inventory. This screen will show the live
          digest the day that endpoint exists; until then there is nothing
          real to display, so nothing is shown.
        </>
      }
      actions={
        <Badge tone="slate" size="sm">
          Not exposed via API
        </Badge>
      }
    />
  );
}

export function HeraldDigestScreen() {
  const [state, setState] = useState<HeraldDigestState | null>(null);

  const probe = () => {
    setState(null);
    void probeHeraldDigest(getSettings().hub.baseUrl).then(setState);
  };

  useEffect(() => {
    let cancelled = false;
    void probeHeraldDigest(getSettings().hub.baseUrl).then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;
  return (
    <div className="flex flex-col gap-3">
      <HeraldDigestView state={state} />
      {state.status === 'not-exposed' && (
        <QButton size="lg" onClick={probe}>
          Check again
        </QButton>
      )}
    </div>
  );
}
