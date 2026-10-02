/**
 * Quantum Create tab — the Nebula image-generation module.
 *
 * Three sub-views over the Nebula JSON API (/api/workflows, /api/run,
 * /api/jobs, /api/gallery): New (run form), Jobs (live queue), Gallery
 * (output grid). When no Nebula base URL is configured, the honest
 * degraded state is the DemoBanner — the module never fakes generations.
 */
import { useState } from 'react';
import { Badge } from '@dsect/ui/components/feedback';
import { DemoBanner } from '../../components/DemoBanner';
import { getSettings } from '../../lib/settings';
import { NewRunView, type CreateConnection } from './NewRunView';
import { JobsView } from './JobsView';
import { GalleryView } from './GalleryView';

type CreateView = 'new' | 'jobs' | 'gallery';

const VIEWS: { id: CreateView; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'gallery', label: 'Gallery' },
];

export function CreateScreen() {
  const settings = getSettings();
  const [view, setView] = useState<CreateView>('new');
  const configured = !!settings.nebula.baseUrl;
  const conn: CreateConnection = {
    baseUrl: settings.nebula.baseUrl,
    passphrase: settings.nebulaPassphrase,
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Create views"
          className="flex flex-1 gap-1 rounded-xl border p-1"
        >
          {VIEWS.map((v) => {
            const active = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(v.id)}
                className="min-h-[44px] flex-1 rounded-lg text-sm font-medium"
                style={
                  active
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--fg-2)' }
                }
              >
                {v.label}
              </button>
            );
          })}
        </div>
        {configured && (
          <Badge tone="ok" size="sm" dot>
            Live
          </Badge>
        )}
      </div>

      <DemoBanner configured={configured} serviceLabel="Nebula" />

      {configured && view === 'new' && (
        <NewRunView key={'new:' + conn.baseUrl} conn={conn} onSubmitted={() => setView('jobs')} />
      )}
      {configured && view === 'jobs' && <JobsView key={'jobs:' + conn.baseUrl} conn={conn} />}
      {configured && view === 'gallery' && (
        <GalleryView key={'gallery:' + conn.baseUrl} conn={conn} />
      )}
    </div>
  );
}
