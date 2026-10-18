/**
 * Feed — The Singularity's home: reverse-chronological, pinned first (no
 * engagement-bait ranking). Real data or an explicitly labeled degraded
 * state — never a fake skeleton (docs/MEMORY.md — design language).
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { FeedPage, Post, ReactionKind } from '../api/types';
import { PostCard } from '../components/PostCard';
import { EmptyState, Spinner, StatusBanner } from '../components/ui';
import { log } from '../lib/logger';

export function FeedScreen({
  client,
  onOpenPost,
  onOpenAuthor,
  onOpenMemory,
  onCompose,
}: {
  client: SingularityClient;
  onOpenPost: (post: Post) => void;
  onOpenAuthor: (handle: string) => void;
  onOpenMemory: (id: string) => void;
  onCompose: () => void;
}) {
  const [page, setPage] = useState<FeedPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      else setState('loading');
      setError(null);
      try {
        const result = await client.feed({ limit: 30 });
        setPage(result);
        setState('ready');
        if (result.degraded) {
          log('feed', `Degraded: ${result.degraded_reason ?? 'unknown'}`, 'warn');
        }
      } catch (err) {
        setError(describeError(err));
        setState('error');
        log('feed', `Load failed: ${(err as Error).message}`, 'error');
      } finally {
        setRefreshing(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const onReact = async (post: Post, kind: ReactionKind) => {
    // Toggle semantics: clicking your own reaction removes it, otherwise add.
    try {
      if (post.my_reactions.includes(kind)) await client.unreactPost(post.id, kind);
      else await client.reactPost(post.id, kind);
    } catch (err) {
      log('feed', `React failed: ${(err as Error).message}`, 'warn');
    }
    await load(true);
  };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <h1 className="h1">Feed</h1>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {page?.degraded && (
        <StatusBanner tone="warn">
          Degraded: {page.degraded_reason ?? 'some sources unavailable'}
        </StatusBanner>
      )}

      {state === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      )}

      {state === 'error' && (
        <div className="card">
          <h2 className="h2">Feed unavailable</h2>
          <p className="muted small" style={{ marginTop: 8 }}>
            {error}
          </p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => load()}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && page && page.posts.length === 0 && (
        <EmptyState
          title="No posts yet"
          hint="Be the first — share an update, ask a question, or open a collab thread."
          action={
            <button type="button" className="btn btn-primary" onClick={onCompose}>
              Write the first post
            </button>
          }
        />
      )}

      {state === 'ready' &&
        page?.posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            onReact={onReact}
            onOpen={onOpenPost}
            onOpenAuthor={onOpenAuthor}
            onOpenMemory={onOpenMemory}
          />
        ))}
    </div>
  );
}
