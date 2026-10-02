/**
 * Messages tab: Hermes relay (threads, thread view, search) + herald digest.
 *
 * Relay screens degrade honestly: no base URL → "not connected" states;
 * unreachable host → error states with retry. The herald digest has no API
 * surface today, so its tab always shows the "not yet exposed" state.
 */
import { useState } from 'react';
import { DemoBanner } from '../components/DemoBanner';
import { getSettings } from '../lib/settings';
import { ThreadsScreen } from './Messages/ThreadsScreen';
import { ThreadScreen } from './Messages/ThreadScreen';
import { SearchScreen } from './Messages/SearchScreen';
import { HeraldDigestScreen } from './Messages/HeraldDigestScreen';
import type { RelayThread } from '../api/relay';

type View = 'threads' | 'search' | 'digest';

const VIEW_LABELS: { id: View; label: string }[] = [
  { id: 'threads', label: 'Threads' },
  { id: 'search', label: 'Search' },
  { id: 'digest', label: 'Digest' },
];

export function MessagesScreen() {
  const [view, setView] = useState<View>('threads');
  const [openThread, setOpenThread] = useState<RelayThread | null>(null);
  const baseUrl = getSettings().relay.baseUrl;

  return (
    <div className="flex flex-col gap-4 p-4">
      <DemoBanner configured={!!baseUrl} serviceLabel="relay" />

      {openThread ? (
        <ThreadScreen
          baseUrl={baseUrl}
          thread={openThread}
          onBack={() => setOpenThread(null)}
        />
      ) : (
        <>
          <div role="tablist" aria-label="Messages views" className="flex gap-2">
            {VIEW_LABELS.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={`min-h-[44px] flex-1 rounded-lg border text-sm font-medium ${
                  view === v.id ? 'border-accent' : 'opacity-70'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {view === 'threads' && (
            <ThreadsScreen baseUrl={baseUrl} onOpenThread={setOpenThread} />
          )}
          {view === 'search' && <SearchScreen baseUrl={baseUrl} />}
          {view === 'digest' && <HeraldDigestScreen />}
        </>
      )}
    </div>
  );
}
