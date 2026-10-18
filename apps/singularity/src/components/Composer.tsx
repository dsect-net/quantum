/**
 * Composer — post creation with kind, tags, and a Hive-memory picker that
 * inserts [[mem:id]] tokens. Used by the Compose screen and the feed's
 * inline composer. Controlled draft lives in the parent screen.
 */
import { useState } from 'react';
import type { Memory, PostKind } from '../api/types';
import { appendMemoryToken, normalizeTags } from '../lib/memrefs';
import { Badge, Sheet } from './ui';

const KINDS: { value: PostKind; label: string }[] = [
  { value: 'post', label: 'Post' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'question', label: 'Question' },
  { value: 'collab', label: 'Collab' },
  { value: 'memory', label: 'Memory note' },
];

export function Composer({
  draft,
  onDraftChange,
  kind,
  onKindChange,
  tags,
  onTagsChange,
  onSubmit,
  submitting,
  submitLabel = 'Publish',
  memorySearch,
}: {
  draft: string;
  onDraftChange: (next: string) => void;
  kind: PostKind;
  onKindChange: (next: PostKind) => void;
  tags: string;
  onTagsChange: (next: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel?: string;
  /** Async memory search backing the picker (usually client.searchMemories). */
  memorySearch: (q: string) => Promise<{ memories: Memory[]; degraded?: boolean }>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Memory[]>([]);
  const [pickerState, setPickerState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [degraded, setDegraded] = useState(false);

  const runSearch = async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setPickerState('loading');
    try {
      const page = await memorySearch(q);
      setResults(page.memories);
      setDegraded(Boolean(page.degraded));
      setPickerState('idle');
    } catch {
      setPickerState('error');
    }
  };

  const insert = (memory: Memory) => {
    onDraftChange(appendMemoryToken(draft, memory.id));
    setPickerOpen(false);
  };

  return (
    <div className="composer">
      <textarea
        className="textarea"
        placeholder="Share an update with the org…  Reference memories as [[mem:id]], mention with @handle."
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        aria-label="Post body"
      />
      <div className="composer-toolbar">
        <select
          className="kind-select"
          value={kind}
          onChange={(e) => onKindChange(e.target.value as PostKind)}
          aria-label="Post kind"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 220, minHeight: 36, padding: '6px 10px', fontSize: 13 }}
          placeholder="tags (comma-separated)"
          value={tags}
          onChange={(e) => onTagsChange(e.target.value)}
          aria-label="Tags"
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen(true)}>
          + Memory
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={submitting || !draft.trim()}
          onClick={onSubmit}
        >
          {submitting ? 'Publishing…' : submitLabel}
        </button>
      </div>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} labelledBy="mem-picker-title">
        <h2 className="h2" id="mem-picker-title">
          Reference a Hive memory
        </h2>
        <p className="muted small" style={{ marginTop: 6 }}>
          Search the Hive and insert a <span className="mono">[[mem:id]]</span> link into your post.
        </p>
        <input
          className="input"
          style={{ marginTop: 12 }}
          placeholder="Search memories…"
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          autoFocus
        />
        {degraded && (
          <p className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
            Memory provider degraded — results may be from the snapshot cache.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          {pickerState === 'loading' ? (
            <p className="muted small">Searching…</p>
          ) : pickerState === 'error' ? (
            <p className="error-text">Search failed — try again.</p>
          ) : results.length === 0 ? (
            <p className="dim small">Type to search {query ? '— nothing matched.' : 'the Hive.'}</p>
          ) : (
            results.map((m) => (
              <button
                key={m.id}
                type="button"
                className="memory-chip"
                onClick={() => insert(m)}
                style={{ marginBottom: 8 }}
              >
                <span className="mem-id">mem:{m.id}</span>
                <span className="mem-label">{m.tags[0] ?? m.kind}</span>
                <span className="mem-excerpt">{m.content}</span>
                <Badge tone={m.source === 'live' ? 'ok' : 'warn'}>
                  {m.source === 'live' ? 'Live' : 'Snapshot'}
                </Badge>
              </button>
            ))
          )}
        </div>
        {normalizeTags(tags).length > 0 && (
          <div className="post-tags" style={{ marginTop: 12 }}>
            {normalizeTags(tags).map((t) => (
              <Badge key={t} tone="muted">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
