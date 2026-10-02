/**
 * Hive memory explorer — over a STATIC vendored snapshot, labeled as such.
 *
 * hive-memory has no live backend (dsect-net/hive-memory reads bundled
 * data/memories.json). This screen vendors a trimmed sample (28 of 368
 * entries) and says "Snapshot — not live" in the banner, the list header,
 * and the detail view. If a memory API ever exists, this screen is where
 * the live client lands — the honesty labels must move with it.
 */
import { useMemo, useState } from 'react';
import { Badge, EmptyState } from '@dsect/ui/components/feedback';
import { Card } from '@dsect/ui/components/surfaces';
import { QButton, QInput } from '../../lib/untitled';
import {
  HIVE_SNAPSHOT,
  HIVE_SNAPSHOT_DATE,
  HIVE_SNAPSHOT_TOTAL,
  type HiveMemory,
} from '../../data/hiveSnapshot';

function tierTone(tier: string): 'ok' | 'info' | 'slate' {
  if (tier === 'durable') return 'ok';
  if (tier === 'project') return 'info';
  return 'slate';
}

function MemoryDetail({ memory, onBack }: { memory: HiveMemory; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <QButton color="secondary" size="md" onPress={onBack}>
          ← Back to list
        </QButton>
      </div>
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warn" size="sm" dot>
              Snapshot — not live
            </Badge>
            <Badge tone={tierTone(memory.tier)} size="sm">
              {memory.tier}
            </Badge>
            <Badge tone="info" size="sm">
              {memory.kind}
            </Badge>
          </div>
          <p className="text-sm">{memory.content}</p>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-text-secondary">Agent</dt>
              <dd className="font-mono">{memory.agent}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-text-secondary">Team</dt>
              <dd className="font-mono">{memory.team}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-text-secondary">Importance</dt>
              <dd className="font-mono">{memory.importance.toFixed(2)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-text-secondary">Captured</dt>
              <dd className="font-mono">{memory.created_at}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-1">
            {memory.tags.map((t) => (
              <Badge key={t} tone="slate" size="sm">
                #{t}
              </Badge>
            ))}
          </div>
          <p className="font-mono text-xs text-text-secondary">
            memory #{memory.id} · snapshot {HIVE_SNAPSHOT_DATE}
          </p>
        </div>
      </Card>
    </div>
  );
}

export function HiveScreen() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<HiveMemory | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return HIVE_SNAPSHOT;
    return HIVE_SNAPSHOT.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.agent.toLowerCase().includes(q) ||
        m.tier.toLowerCase().includes(q) ||
        m.kind.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [query]);

  if (selected) return <MemoryDetail memory={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Memory explorer</h2>
          <Badge tone="warn" size="sm" dot>
            Snapshot — not live
          </Badge>
        </div>
        <p className="text-sm text-text-secondary">
          {results.length} of {HIVE_SNAPSHOT.length} sampled memories (source
          snapshot held {HIVE_SNAPSHOT_TOTAL}, sampled {HIVE_SNAPSHOT_DATE}).
          hive-memory has no live backend — this is a static picture, not the
          fleet's current memory.
        </p>
      </div>

      <QInput
        label="Search snapshot"
        placeholder="content, agent, tag, tier…"
        value={query}
        onChange={setQuery}
        aria-label="Search snapshot"
      />

      {results.length === 0 ? (
        <EmptyState
          mark="∅"
          title="No matches"
          text={<>Nothing in the snapshot matches “{query}”.</>}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {results.map((m) => (
            <li key={m.id}>
              <Card>
                <button
                  type="button"
                  onClick={() => setSelected(m)}
                  className="flex w-full flex-col gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone={tierTone(m.tier)} size="sm">
                      {m.tier}
                    </Badge>
                    <span className="font-mono text-xs text-text-secondary">
                      #{m.id} · {m.agent} · {m.importance.toFixed(2)}
                    </span>
                  </span>
                  <span className="line-clamp-3 text-sm">{m.content}</span>
                  <span className="flex flex-wrap gap-1">
                    {m.tags.slice(0, 4).map((t) => (
                      <Badge key={t} tone="slate" size="sm">
                        #{t}
                      </Badge>
                    ))}
                  </span>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="font-mono text-xs text-text-secondary">
        End of snapshot sample — not live. For the full 368-memory picture,
        browse the hive-memory repo's data/memories.json ({HIVE_SNAPSHOT_DATE}).
      </p>
    </div>
  );
}
