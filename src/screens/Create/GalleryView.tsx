/**
 * Create → Gallery: the Nebula output grid.
 *
 * GET /api/gallery?kind=image, newest first, paginated. Thumbnails come
 * from /api/thumb/{path}; tapping a tile opens the full file from
 * /api/file/{path}. Both go through AuthenticatedImage so the passphrase
 * rides along off-tailnet.
 *
 * Honest about emptiness: a gallery with nothing in it says so instead of
 * showing placeholders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, Spinner } from '@dsect/ui/components/feedback';
import { listGallery, type GalleryItem } from '../../api/nebula';
import type { CreateConnection } from './NewRunView';
import { ErrorBox } from './NewRunView';
import { AuthenticatedImage } from './AuthenticatedImage';

const PAGE = 60;

export interface GalleryViewProps {
  conn: CreateConnection;
}

function formatDate(mtime: number): string {
  if (!mtime) return '';
  return new Date(mtime * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function GalleryView({ conn }: GalleryViewProps) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Lock body scroll while the viewer is open.
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

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}
      {total != null && (
        <p className="text-xs text-text-secondary" role="status">
          {items.length} of {total} images
        </p>
      )}
      <div className="grid grid-cols-3 gap-2" role="list" aria-label="Generated images">
        {items.map((item) => (
          <button
            key={item.path}
            type="button"
            role="listitem"
            onClick={() => setViewer(item)}
            aria-label={'Open ' + item.path}
            className="relative aspect-square overflow-hidden rounded-lg border p-0"
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
          </button>
        ))}
      </div>
      {total != null && items.length < total && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="btn min-h-[48px] rounded-xl font-medium"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}

      {viewer && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={'Image: ' + viewer.path}
          onClick={() => setViewer(null)}
        >
          <div className="flex items-center justify-between gap-2 pb-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{viewer.path.split('/').pop()}</p>
              <p className="text-xs text-white/70">
                {[formatDate(viewer.mtime), viewer.backend].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setViewer(null)}
              className="btn btn-small min-h-[44px] shrink-0"
              aria-label="Close image viewer"
            >
              Close
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <AuthenticatedImage
              baseUrl={conn.baseUrl}
              passphrase={conn.passphrase}
              path={viewer.path}
              kind="file"
              alt={viewer.path}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
