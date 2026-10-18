/**
 * Memory views — chips (feed) and the detail sheet. Provenance is always
 * visible ("Snapshot" vs "Live") per the memory convention in
 * docs/MEMORY.md: never present snapshot data as live.
 */
import type { ReactNode } from 'react';
import type { Memory, MemoryRef } from '../api/types';
import { Badge, Sheet } from './ui';

export function MemoryChip({
  ref_,
  onOpen,
}: {
  ref_: MemoryRef;
  onOpen: (memoryId: string) => void;
}) {
  const memory = ref_.memory;
  const label = ref_.label || (memory ? memory.tags[0] ?? memory.kind : 'memory');
  const excerpt = memory ? memory.content : 'Reference — open to resolve';
  return (
    <button type="button" className="memory-chip" onClick={() => onOpen(ref_.memory_id)}>
      <span className="mem-id">mem:{ref_.memory_id}</span>
      <span className="mem-label">{label}</span>
      <span className="mem-excerpt">{excerpt}</span>
    </button>
  );
}

export function MemorySheet({
  memory,
  loading,
  error,
  onClose,
}: {
  memory: Memory | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const open = Boolean(memory) || loading || Boolean(error);
  let content: ReactNode = null;
  if (loading) {
    content = <p className="muted small">Resolving memory…</p>;
  } else if (error) {
    content = <p className="error-text">{error}</p>;
  } else if (memory) {
    content = (
      <div>
        <div className="row-between">
          <h2 className="h2" id="memory-sheet-title">
            <span className="mono">mem:{memory.id}</span>
          </h2>
          <Badge tone={memory.source === 'live' ? 'ok' : 'warn'}>
            {memory.source === 'live' ? 'Live' : 'Snapshot — not live'}
          </Badge>
        </div>
        <p className="post-body" style={{ marginTop: 12 }}>
          {memory.content}
        </p>
        <dl className="kv" style={{ marginTop: 16 }}>
          <dt>Agent</dt>
          <dd>{memory.agent || '—'}</dd>
          <dt>Team</dt>
          <dd>{memory.team || '—'}</dd>
          <dt>Kind</dt>
          <dd>{memory.kind || '—'}</dd>
          <dt>Tier</dt>
          <dd>{memory.tier || '—'}</dd>
          <dt>Importance</dt>
          <dd>{memory.importance.toFixed(2)}</dd>
          <dt>Recorded</dt>
          <dd>{memory.created_at.slice(0, 10)}</dd>
        </dl>
        {memory.tags.length > 0 && (
          <div className="post-tags" style={{ marginTop: 12 }}>
            {memory.tags.map((t) => (
              <Badge key={t} tone="muted">
                {t}
              </Badge>
            ))}
          </div>
        )}
        <button type="button" className="btn btn-secondary" style={{ marginTop: 18 }} onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} labelledBy="memory-sheet-title">
      {content}
    </Sheet>
  );
}
