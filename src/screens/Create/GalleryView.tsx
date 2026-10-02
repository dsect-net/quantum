/**
 * Create → Gallery: the Nebula output grid.
 *
 * GET /api/gallery?kind=image, newest first, paginated. Thumbnails come
 * from /api/thumb/{path}; tapping a tile opens the full file from
 * /api/file/{path}. Both go through AuthenticatedImage so the passphrase
 * rides along off-tailnet.
 *
 * Mirrors Nebula's gallery where the client allows it: a "Filter by name…"
 * search row and an icon grid/list layout toggle. Two honest gaps are
 * noted rather than faked:
 *  - Nebula's kind icon pills (Images/Video/Meshes/Audio) need a kind the
 *    server filters on; the client hardcodes kind=image, so no kind
 *    filter is shown;
 *  - the search is client-side over the loaded page (the client exposes
 *    no server-side search).
 *
 * Honest about emptiness: a gallery with nothing in it says so instead of
 * showing placeholders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { IconButton } from '@dsect/ui/components/buttons';
import { Dialog } from '@dsect/ui/components/overlays';
import { SearchInput } from '@dsect/ui/components/navigation';
import { LayoutGrid, List } from 'lucide-react';
import { QButton } from '../../lib/untitled';
import { listGallery, type GalleryItem } from '../../api/nebula';
import type { CreateConnection } from './NewRunView';
import { ErrorBox } from './NewRunView';
import { AuthenticatedImage } from './AuthenticatedImage';

const PAGE = 60;

export interface GalleryViewProps {
  conn: CreateConnection;
}

type Layout = 'grid' | 'list';

function formatDate(mtime: number): string {
  if (!mtime) return '';
  return new Date(mtime * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function GalleryView({ conn }: GalleryViewProps) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<Layout>('grid');
  const [viewer, setViewer] = useState<GalleryItem | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      try {
        const res = await listGallery(PAGE, offset, {
          baseUrl: conn.baseUrl,
          passphrase: conn.passphrase,
          signal: ctrl.current?.signal ?? null,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not load the gallery.',
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [conn.baseUrl, conn.passphrase],
  );

  useEffect(() => {
    ctrl.current = new AbortController();
    loadPage(0, false);
    return () => {
      ctrl.current?.abort();
    };
  }, [loadPage]);

  // Lock body scroll while the viewer is open (the sheet Dialog is modal,
  // but the page behind a native dialog can still scroll on touch).
  useEffect(() => {
    if (!viewer) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [viewer]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);
    loadPage(items.length, true);
  };

  const q = query.trim().toLowerCase();
  const filtered = q ? items.filter((it) => it.path.toLowerCase().includes(q)) : items;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner label="Loading gallery" />
      </div>
    );
  }
  if (error && items.length === 0) {
    return <ErrorBox message={error} onRetry={() => loadPage(0, false)} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        mark="◌"
        title="No images yet"
        text="Nothing in the Nebula output folder. Generate something from the New tab and it will land here."
      />
    );
  }

  const toggle = (next: Layout, label: string, Icon: typeof LayoutGrid) => (
    <IconButton
      label={label}
      role="radio"
      aria-checked={layout === next}
      onClick={() => setLayout(next)}
      style={layout === next ? { background: 'var(--surface)', color: 'var(--fg)' } : undefined}
    >
      <Icon aria-hidden="true" />
    </IconButton>
  );

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}

      {/* Nebula's second toolbar row: the name filter and the grid/list
          toggle share one row. Its toggle is a radiogroup rather than a
          switch for the same reason Nebula chose radios: a switch would
          have to announce "list view, off" to mean "grid". */}
      <div className="flex items-center gap-2">
        <SearchInput
          placeholder="Filter by name…"
          aria-label="Filter by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input min-h-[44px] flex-1"
        />
        <div role="radiogroup" aria-label="Gallery layout" className="flex shrink-0 gap-1">
          {toggle('grid', 'Grid view', LayoutGrid)}
          {toggle('list', 'List view', List)}
        </div>
      </div>

      {total != null && (
        <p className="text-xs text-text-secondary" role="status">
          {q
            ? `${filtered.length} of ${items.length} loaded match the filter`
            : `${items.length} of ${total} images`}
        </p>
      )}

      {layout === 'grid' ? (
        <div className="grid grid-cols-3 gap-2" role="list" aria-label="Generated images">
          {filtered.map((item) => (
            <QButton
              key={item.path}
              type="button"
              color="tertiary"
              onClick={() => setViewer(item)}
              aria-label={'Open ' + item.path}
              className="aspect-square w-full overflow-hidden rounded-lg p-0!"
            >
              <AuthenticatedImage
                baseUrl={conn.baseUrl}
                passphrase={conn.passphrase}
                path={item.path}
                kind="thumb"
                size={320}
                alt={item.path}
                className="h-full w-full object-cover"
                style={{ minHeight: '100%' }}
              />
            </QButton>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2" role="list" aria-label="Generated images">
          {filtered.map((item) => (
            <QButton
              key={item.path}
              type="button"
              color="tertiary"
              onClick={() => setViewer(item)}
              aria-label={'Open ' + item.path}
              className="w-full"
            >
              <span className="flex w-full items-center gap-3 text-left">
                <AuthenticatedImage
                  baseUrl={conn.baseUrl}
                  passphrase={conn.passphrase}
                  path={item.path}
                  kind="thumb"
                  size={112}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded object-cover"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{basename(item.path)}</span>
                  <span className="block text-xs text-text-secondary">
                    {[formatDate(item.mtime), item.backend].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
            </QButton>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <p className="text-sm text-text-secondary" role="status">
          No loaded images match that filter.
        </p>
      )}

      {total != null && items.length < total && (
        <QButton
          type="button"
          color="secondary"
          onClick={loadMore}
          isDisabled={loadingMore}
          isLoading={loadingMore}
          showTextWhileLoading
          className="min-h-[48px] w-full"
        >
          Load more
        </QButton>
      )}

      <Dialog
        open={viewer !== null}
        onClose={() => setViewer(null)}
        variant="sheet"
        title={viewer ? basename(viewer.path) : ''}
        footer={
          <QButton type="button" color="secondary" onClick={() => setViewer(null)} className="w-full">
            Close
          </QButton>
        }
      >
        {viewer && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-text-secondary">
              {[formatDate(viewer.mtime), viewer.backend].filter(Boolean).join(' · ')}
            </p>
            <AuthenticatedImage
              baseUrl={conn.baseUrl}
              passphrase={conn.passphrase}
              path={viewer.path}
              kind="file"
              alt={viewer.path}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
