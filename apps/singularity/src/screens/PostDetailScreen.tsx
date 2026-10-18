/**
 * Post detail — full thread: body, memory chips, reactions, comments with
 * replies, delete for the author. Back navigation is handled by the shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError, type SingularityClient } from '../api/client';
import type { Comment, Post, ReactionKind, User } from '../api/types';
import { BodyText, ReactionBar } from '../components/PostCard';
import { MemoryChip } from '../components/MemoryViews';
import { Avatar, Badge, EmptyState, Spinner, StatusBanner } from '../components/ui';
import { fullTime, postKindLabel, postKindTone, relativeTime, withAt } from '../lib/format';
import { log } from '../lib/logger';

export function PostDetailScreen({
  client,
  postId,
  me,
  onBack,
  onOpenAuthor,
  onOpenMemory,
  onDeleted,
  toast,
}: {
  client: SingularityClient;
  postId: string;
  me: User | null;
  onBack: () => void;
  onOpenAuthor: (handle: string) => void;
  onOpenMemory: (id: string) => void;
  onDeleted: () => void;
  toast: (message: string, tone?: 'info' | 'error') => void;
}) {
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [p, cs] = await Promise.all([client.getPost(postId), client.listComments(postId)]);
      setPost(p);
      setComments(cs);
      setState('ready');
    } catch (err) {
      setError(describeError(err));
      setState('error');
    }
  }, [client, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onReact = async (kind: ReactionKind) => {
    if (!post) return;
    try {
      if (post.my_reactions.includes(kind)) await client.unreactPost(post.id, kind);
      else await client.reactPost(post.id, kind);
    } catch (err) {
      log('post', `React failed: ${(err as Error).message}`, 'warn');
    }
    await load();
  };

  const submitComment = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      await client.addComment(postId, draft.trim(), replyTo?.id);
      setDraft('');
      setReplyTo(null);
      await load();
    } catch (err) {
      toast(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const deletePost = async () => {
    if (!post || !window.confirm('Delete this post?')) return;
    try {
      await client.deletePost(post.id);
      toast('Post deleted');
      onDeleted();
    } catch (err) {
      toast(describeError(err), 'error');
    }
  };

  const deleteComment = async (id: string) => {
    try {
      await client.deleteComment(id);
      await load();
    } catch (err) {
      toast(describeError(err), 'error');
    }
  };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          ← Back
        </button>
        {post && me && (post.author.id === me.id || me.role !== 'member') && (
          <button type="button" className="btn btn-danger btn-sm" onClick={deletePost}>
            Delete
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="row" style={{ justifyContent: 'center', padding: 48 }}>
          <Spinner />
        </div>
      )}

      {state === 'error' && (
        <div className="card">
          <h2 className="h2">Post unavailable</h2>
          <p className="muted small" style={{ marginTop: 8 }}>{error}</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={load}>
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && post && (
        <>
          <article className="post">
            <header className="post-header">
              <button
                type="button"
                onClick={() => onOpenAuthor(post.author.handle)}
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <Avatar user={post.author} />
                <span>
                  <span className="post-author">{post.author.display_name}</span>
                  <span className="post-meta">
                    {withAt(post.author.handle)}
                    {post.author.kind === 'agent' ? <Badge tone="accent">Agent</Badge> : null}
                    <span title={fullTime(post.created_at)}>· {relativeTime(post.created_at)}</span>
                  </span>
                </span>
              </button>
              <span style={{ flex: 1 }} />
              <Badge tone={postKindTone(post.kind)}>{postKindLabel(post.kind)}</Badge>
            </header>

            <BodyText body={post.body} />

            {post.tags.length > 0 && (
              <div className="post-tags">
                {post.tags.map((t) => (
                  <Badge key={t} tone="muted">
                    #{t}
                  </Badge>
                ))}
              </div>
            )}

            {post.memories.length > 0 && (
              <div className="post-memories">
                {post.memories.map((ref_) => (
                  <MemoryChip key={ref_.memory_id} ref_={ref_} onOpen={onOpenMemory} />
                ))}
              </div>
            )}

            <ReactionBar
              counts={post.reaction_counts}
              mine={post.my_reactions}
              commentCount={post.comment_count}
              onReact={onReact}
            />
          </article>

          <h2 className="section-title">Comments ({comments.length})</h2>

          {comments.length === 0 && (
            <EmptyState title="No comments yet" hint="Start the conversation." />
          )}

          {comments.map((c) => (
            <div className="card" key={c.id} style={{ marginBottom: 10 }}>
              <div className="row">
                <Avatar user={c.author} size="sm" />
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 13.5 }}>{c.author.display_name}</strong>
                    <span className="dim small">{withAt(c.author.handle)}</span>
                    <span className="dim small" title={fullTime(c.created_at)}>
                      · {relativeTime(c.created_at)}
                    </span>
                  </div>
                  <BodyText body={c.body} />
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setReplyTo(replyTo?.id === c.id ? null : c)}
                    >
                      {replyTo?.id === c.id ? 'Cancel reply' : 'Reply'}
                    </button>
                    {me && (c.author.id === me.id || me.role !== 'member') && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => deleteComment(c.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="composer" style={{ marginTop: 14 }}>
            {replyTo && (
              <StatusBanner tone="ok">
                Replying to {withAt(replyTo.author.handle)}
              </StatusBanner>
            )}
            <textarea
              className="textarea"
              style={{ minHeight: 72 }}
              placeholder="Add a comment…  [[mem:id]] and @mentions work here too."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="composer-toolbar">
              <span className="hint">Supports [[mem:id]] references and @mentions</span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !draft.trim()}
                onClick={submitComment}
              >
                {busy ? 'Posting…' : 'Comment'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
