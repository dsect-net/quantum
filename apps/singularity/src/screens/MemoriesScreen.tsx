/**
 * Memories — browse and search the Hive from the app. Provenance badges are
 * mandatory here (snapshot vs live); the app never claims snapshot data is
 * live (docs/MEMORY.md — memory convention).
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { Memory } from '../api/types';
import { Badge, EmptyState, Spinner, StatusBanner } from '../components/ui';

export function MemoriesScreen({
  client,
  onOpenMemory,
}: {
  client: SingularityClient;
  onOpenMemory: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [degraded, setDegraded] = useState<string | null>(null);

  const load = useCallback(
    async (q: string) => {
      setState('loading');
      setDegraded(null);
      try {
        const page = await client.searchMemories({ q: q.trim() || undefined, limit: 50 });
        setMemories(page.memories);
        setDegraded(page.degraded ? page.degraded_reason ?? 'Memory provider degraded' : null);
        setState('ready');
      } catch (err) {
        setState('error');
        setDegraded(describeError(err));
      }
    },
    [client],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div>
      <h1 className="h1" style={{ marginBottom: 12 }}>
        Hive memories
      </h1>
      <p className="muted small" style={{ marginBottom: 12 }}>
        Reference any memory in a post with <span className="mono">[[mem:id]]</span>.
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Search memories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void load(query);
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => load(query)}>
          Search
        </button>
      </div>

      {degraded && <StatusBanner tone="warn">{degraded}</StatusBanner>}

      {state === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      )}

      {state === 'error' && (
        <div className="card">
          <h2 className="h2">Memory search failed</h2>
          <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => load(query)}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && memories.length === 0 && (
        <EmptyState title="No memories matched" hint="Try a different query." />
      )}

      {state === 'ready' &&
        memories.map((m) => (
          <button key={m.id} type="button" className="list-item" onClick={() => onOpenMemory(m.id)}>
            <span className="grow">
              <span className="title">
                <span className="mono" style={{ color: 'var(--accent)' }}>
                  mem:{m.id}
                </span>{' '}
                {m.tags[0] ? `· ${m.tags[0]}` : ''}
              </span>
              <span className="subtitle">{m.content}</span>
            </span>
            <Badge tone={m.source === 'live' ? 'ok' : 'warn'}>
              {m.source === 'live' ? 'Live' : 'Snapshot'}
            </Badge>
          </button>
        ))}
    </div>
  );
}
