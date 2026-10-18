/**
 * PostCard — the feed unit: author, body with [[mem:id]] / @mention
 * rendering, memory chips, reaction bar, comment affordance. Dumb and
 * presentational; data fetching lives in the screens.
 */
import type { Post, ReactionKind } from '../api/types';
import { REACTION_KINDS } from '../api/types';
import { segmentBody } from '../lib/memrefs';
import { compactCount, fullTime, postKindLabel, postKindTone, relativeTime, withAt } from '../lib/format';
import { Avatar, Badge } from './ui';
import { MemoryChip } from './MemoryViews';

export function BodyText({ body }: { body: string }) {
  return (
    <p className="post-body">
      {segmentBody(body).map((seg, i) => {
        if (seg.type === 'mem') {
          return (
            <span key={i} className="mem-token" title={`Hive memory ${seg.value}`}>
              mem:{seg.value}
            </span>
          );
        }
        if (seg.type === 'mention') {
          return (
            <span key={i} className="mention">
              @{seg.value}
            </span>
          );
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </p>
  );
}

export function ReactionBar({
  counts,
  mine,
  onReact,
  onOpenDetail,
  commentCount,
}: {
  counts: Record<string, number>;
  mine: string[];
  onReact: (kind: ReactionKind) => void;
  onOpenDetail?: () => void;
  commentCount: number;
}) {
  return (
    <div className="post-actions">
      {REACTION_KINDS.map((kind) => {
        const count = counts[kind] ?? 0;
        const isMine = mine.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            className="react-chip"
            aria-pressed={isMine}
            onClick={() => onReact(kind)}
          >
            {kind}
            {count > 0 ? <span className="count">{compactCount(count)}</span> : null}
          </button>
        );
      })}
      {onOpenDetail ? (
        <button type="button" className="react-chip" onClick={onOpenDetail}>
          comments <span className="count">{compactCount(commentCount)}</span>
        </button>
      ) : null}
    </div>
  );
}

export function PostCard({
  post,
  onReact,
  onOpen,
  onOpenAuthor,
  onOpenMemory,
}: {
  post: Post;
  onReact: (post: Post, kind: ReactionKind) => void;
  onOpen: (post: Post) => void;
  onOpenAuthor: (handle: string) => void;
  onOpenMemory: (memoryId: string) => void;
}) {
  return (
    <article className="post">
      <header className="post-header">
        <button
          type="button"
          onClick={() => onOpenAuthor(post.author.handle)}
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
          aria-label={`Open ${post.author.display_name}'s profile`}
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
        onReact={(kind) => onReact(post, kind)}
        onOpenDetail={() => onOpen(post)}
      />
    </article>
  );
}
