/**
 * Quantum Create tab — the Nebula image-generation module.
 *
 * Three sub-views over the Nebula JSON API (/api/workflows, /api/run,
 * /api/jobs, /api/gallery): New (the "Run a workflow" card), Jobs (live
 * queue), Gallery (output grid). The sub-view switcher is the design-system
 * Tabs component — Nebula's own app is a tab strip on desktop and a bottom
 * bar on phones; here the module-level switcher stays a top tab strip so
 * the phone's app-level bottom bar keeps exactly one "Create" entry.
 *
 * When no Nebula base URL is configured, the honest degraded state is the
 * DemoBanner — the module never fakes generations. Sub-views stay inert
 * (no network) until configured.
 */
import { useState } from 'react';
import { Badge } from '@dsect/ui/components/feedback';
import { Tabs, type TabItem } from '@dsect/ui/components/overlays';
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

  // The panel for an unselected tab is null, so switching views unmounts
  // the old one (fresh fetch, like the tab strip it replaces). When
  // unconfigured every panel is null: no network, just the demo banner.
  const tabs: TabItem[] = VIEWS.map((v) => ({
    id: v.id,
    label: v.label,
    panel:
      configured && view === v.id ? (
        v.id === 'new' ? (
          <NewRunView key={'new:' + conn.baseUrl} conn={conn} onSubmitted={() => setView('jobs')} />
        ) : v.id === 'jobs' ? (
          <JobsView key={'jobs:' + conn.baseUrl} conn={conn} />
        ) : (
          <GalleryView key={'gallery:' + conn.baseUrl} conn={conn} />
        )
      ) : null,
  }));

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <Tabs
          tabs={tabs}
          label="Create views"
          value={view}
          onChange={(id) => setView(id as CreateView)}
          className="flex-1"
        />
        {configured && (
          <Badge tone="ok" size="sm" dot>
            Live
          </Badge>
        )}
      </div>

      <DemoBanner configured={configured} serviceLabel="Nebula" />
    </div>
  );
}
